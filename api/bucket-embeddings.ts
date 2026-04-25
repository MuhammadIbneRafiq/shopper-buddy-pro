import type { VercelRequest, VercelResponse } from '@vercel/node';

const BEDROCK_URL =
  'https://bedrock-runtime.us-east-1.amazonaws.com/model/amazon.nova-2-multimodal-embeddings-v1:0/invoke';

// Bucket canonical texts — must stay in sync with src/lib/rag-buckets.ts
const BUCKETS = [
  {
    id: 'CHECKOUT_INITIATE',
    text: "User is ready to complete their shopping and wants to pay. They want to proceed to checkout and complete the purchase. Examples: pay now, I want to pay, checkout, I'm done shopping, finish and pay, proceed to checkout, let's pay, done, ready to pay, ring me up, that's everything, take my money.",
  },
  {
    id: 'SCAN_PRODUCT',
    text: "User wants to scan a product barcode, add an item to their shopping cart, or identify a product and its price using the camera. Examples: scan this, add this product, scan the barcode, add it, what's the price, put it in my cart, read the barcode, I want to add this item.",
  },
  {
    id: 'BALANCE_CHECK',
    text: "User wants to check their account balance, see how much money they have available, or verify they have enough funds to cover their purchase before paying. Examples: what's my balance, how much money do I have, can I afford this, do I have enough funds, check my account balance, how much left, am I short.",
  },
  {
    id: 'PAYMENT_STATUS',
    text: "User is asking about the status or progress of a payment that is currently being processed. They want to know if the payment has completed, is still processing, or has failed. Examples: is the payment done, did it go through, is it finished, payment status, is it processing, how long will this take, did the transaction complete.",
  },
  {
    id: 'ALLERGEN_QUERY',
    text: "User wants to know about allergens, ingredients, or dietary suitability of a product they have scanned. They may have allergies or dietary restrictions such as gluten intolerance, nut allergy, lactose intolerance, or veganism. Examples: does this have nuts, is this gluten free, any dairy in this, what allergens are in this, is this safe to eat, does it contain lactose, is this vegan, what's in it.",
  },
  {
    id: 'APP_ONBOARDING',
    text: "A first-time user needs onboarding help, wants to select or switch their input mode between button and voice, or needs guidance on how to use the app. Examples: button mode, voice mode, how do I use this, help, I'm new here, get started, what can you do, switch to voice, instructions please, how does this work.",
  },
  {
    id: 'BASKET_REVIEW',
    text: "User wants to review the contents of their shopping basket or cart, see the running total price, remove or delete a specific item, or clear the entire basket. Examples: show my basket, what's in my cart, remove the last item, what's my total, delete that item, clear basket, show what I've scanned, how many items do I have.",
  },
  {
    id: 'CANCEL_ABORT',
    text: "User wants to cancel the current operation, stop what is happening, go back to the previous screen, abort an action, or indicates they have changed their mind. Examples: cancel, stop, abort, go back, never mind, I changed my mind, quit, exit, forget it, actually no.",
  },
];

// In-memory cache — survives warm lambda invocations
let cache: { id: string; embedding: number[] }[] | null = null;

async function embedText(text: string, token: string): Promise<number[]> {
  // Nova multimodal embeddings supports text-only input
  const payload = {
    schemaVersion: 'nova-multimodal-embed-v1',
    taskType: 'SINGLE_EMBEDDING',
    singleEmbeddingParams: {
      embeddingPurpose: 'GENERIC_INDEX',
      embeddingDimension: 1024,
      text: { text },
    },
  };

  const res = await fetch(BEDROCK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`Bedrock error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.embeddings?.[0]?.embedding ?? [];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.VITE_AWS_BEARER_TOKEN_BEDROCK;
  if (!token) return res.status(500).json({ error: 'AWS token not configured' });

  // Return cached embeddings if available
  if (cache) return res.status(200).json({ buckets: cache });

  // Compute all bucket embeddings in parallel
  try {
    const results = await Promise.all(
      BUCKETS.map(async (b) => ({
        id: b.id,
        embedding: await embedText(b.text, token),
      }))
    );
    cache = results;
    return res.status(200).json({ buckets: cache });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ error: msg });
  }
}
