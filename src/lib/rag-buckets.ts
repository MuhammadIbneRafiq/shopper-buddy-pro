/**
 * Vector bucket definitions for Shopper Buddy RAG intent classifier.
 *
 * Each bucket represents a semantically distinct user intent. At runtime:
 *   1. Embed `canonicalText` once and store the vector in the DB.
 *   2. On a voice query, embed the query and run cosine similarity search.
 *   3. The closest bucket drives the app's response.
 *
 * ─── RECOMMENDED OPEN-SOURCE RAG STACK ───────────────────────────────────────
 *
 * Since this project already uses Supabase, everything is already there:
 *
 *   Vector store  → Supabase pgvector (enable via `CREATE EXTENSION vector`)
 *   Embeddings    → OpenAI text-embedding-3-small (128-dim, fast, cheap)
 *                   called from a Supabase Edge Function to keep the key server-side
 *   Similarity    → `match_buckets` RPC (cosine, top-1 with a score threshold)
 *   Classification→ Edge Function: embed query → pgvector search → return bucket id
 *
 * Fully open-source alternative (no OpenAI):
 *   Embeddings    → nomic-embed-text via Hugging Face Inference API (free tier)
 *   Vector store  → LanceDB (embedded, zero infra, works inside Edge Functions)
 *
 * SQL to set up pgvector buckets table:
 *   CREATE EXTENSION IF NOT EXISTS vector;
 *   CREATE TABLE rag_buckets (
 *     id           TEXT PRIMARY KEY,
 *     embedding    vector(1536),  -- 3072 for text-embedding-3-large
 *     metadata     JSONB
 *   );
 *   CREATE INDEX ON rag_buckets USING hnsw (embedding vector_cosine_ops);
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface VectorBucket {
  id: string;
  label: string;
  description: string;
  /** Keys match situation IDs in shopper-buddy-situations.txt */
  situationRefs: string[];
  /** Representative voice utterances — also used to enrich the embedding */
  utterances: string[];
  /**
   * The single text we embed and store as this bucket's vector.
   * Combines intent description + key phrases so the stored vector sits
   * centrally in the semantic space of all plausible queries for this intent.
   */
  canonicalText: string;
}

export const VECTOR_BUCKETS: VectorBucket[] = [
  {
    id: "CHECKOUT_INITIATE",
    label: "Checkout / Pay",
    description: "User is done shopping and wants to proceed to payment.",
    situationRefs: ["checkout_public_place", "basket_empty_checkout"],
    utterances: [
      "I want to pay",
      "checkout",
      "I'm done shopping",
      "proceed to checkout",
      "let's pay",
      "pay now",
      "I'm ready to pay",
      "done shopping",
      "finish and pay",
      "take my money",
      "ring me up",
      "that's everything",
    ],
    canonicalText:
      "User is ready to complete their shopping and wants to pay. They want to proceed to checkout and complete the purchase. " +
      "Examples: pay now, I want to pay, checkout, I'm done shopping, finish and pay, proceed to checkout, " +
      "let's pay, done, ready to pay, ring me up, that's everything, take my money.",
  },

  {
    id: "SCAN_PRODUCT",
    label: "Scan / Add Product",
    description:
      "User wants to scan a barcode, add an item to the basket, or identify a product and its price.",
    situationRefs: [
      "scanning_in_progress",
      "product_added_confirmation",
      "product_unrecognized",
    ],
    utterances: [
      "scan this",
      "add this product",
      "scan the barcode",
      "add it to my cart",
      "what's the price of this",
      "I want to add this item",
      "scan this thing",
      "put it in my cart",
      "read the barcode",
      "can you scan this",
    ],
    canonicalText:
      "User wants to scan a product barcode, add an item to their shopping cart, or identify a product " +
      "and its price using the camera. " +
      "Examples: scan this, add this product, scan the barcode, add it, what's the price, " +
      "put it in my cart, read the barcode, I want to add this item.",
  },

  {
    id: "BALANCE_CHECK",
    label: "Check Account Balance",
    description:
      "User wants to know their current account balance or whether they can afford the basket.",
    situationRefs: ["low_balance_warning"],
    utterances: [
      "what's my balance",
      "how much money do I have",
      "can I afford this",
      "do I have enough",
      "check my account",
      "how much is in my account",
      "what's my budget",
      "how much do I have left",
      "am I short",
      "will I run out of money",
    ],
    canonicalText:
      "User wants to check their account balance, see how much money they have available, or verify " +
      "they have enough funds to cover their purchase before paying. " +
      "Examples: what's my balance, how much money do I have, can I afford this, " +
      "do I have enough funds, check my account balance, how much left, am I short.",
  },

  {
    id: "PAYMENT_STATUS",
    label: "Payment Status",
    description: "User is asking about the progress or result of an in-flight payment.",
    situationRefs: ["payment_processing"],
    utterances: [
      "is the payment done",
      "did it go through",
      "what's happening",
      "how long will this take",
      "payment status",
      "is it processing",
      "any update on my payment",
      "is it finished",
      "did the transaction complete",
      "what's taking so long",
    ],
    canonicalText:
      "User is asking about the status or progress of a payment that is currently being processed. " +
      "They want to know if the payment has completed, is still processing, or has failed. " +
      "Examples: is the payment done, did it go through, is it finished, payment status, " +
      "is it processing, how long will this take, did the transaction complete.",
  },

  {
    id: "ALLERGEN_QUERY",
    label: "Allergen / Ingredients Check",
    description:
      "User asks about allergens, ingredients, or dietary suitability of a scanned product.",
    situationRefs: ["allergen_detected"],
    utterances: [
      "does this have nuts",
      "is this gluten free",
      "any dairy in this",
      "what allergens does this have",
      "what's in this product",
      "is this safe for me to eat",
      "does it contain lactose",
      "is this vegan",
      "can I eat this",
      "does it have wheat",
      "ingredients please",
    ],
    canonicalText:
      "User wants to know about allergens, ingredients, or dietary suitability of a product they have scanned. " +
      "They may have allergies or dietary restrictions such as gluten intolerance, nut allergy, lactose intolerance, or veganism. " +
      "Examples: does this have nuts, is this gluten free, any dairy in this, " +
      "what allergens are in this, is this safe to eat, does it contain lactose, is this vegan, what's in it.",
  },

  {
    id: "APP_ONBOARDING",
    label: "Onboarding / Mode Setup",
    description:
      "First-time user needs guidance, wants to select or switch input mode, or asks how the app works.",
    situationRefs: ["first_time_user"],
    utterances: [
      "button mode",
      "voice mode",
      "how do I use this",
      "help",
      "I'm new",
      "get started",
      "what can you do",
      "switch to voice",
      "use button input",
      "how does this work",
      "instructions please",
    ],
    canonicalText:
      "A first-time user needs onboarding help, wants to select or switch their input mode between button and voice, " +
      "or needs guidance on how to use the app. " +
      "Examples: button mode, voice mode, how do I use this, help, I'm new here, get started, " +
      "what can you do, switch to voice, instructions please, how does this work.",
  },

  {
    id: "BASKET_REVIEW",
    label: "Basket Review / Edit",
    description:
      "User wants to view basket contents, see the running total, remove an item, or clear the basket.",
    situationRefs: [],
    utterances: [
      "show my basket",
      "what's in my cart",
      "remove the last item",
      "what's my total",
      "what did I add",
      "delete that item",
      "clear my basket",
      "show me what I've scanned",
      "how many items do I have",
      "what have I got so far",
    ],
    canonicalText:
      "User wants to review the contents of their shopping basket or cart, see the running total price, " +
      "remove or delete a specific item, or clear the entire basket. " +
      "Examples: show my basket, what's in my cart, remove the last item, what's my total, " +
      "delete that item, clear basket, show what I've scanned, how many items do I have.",
  },

  {
    id: "CANCEL_ABORT",
    label: "Cancel / Abort",
    description: "User wants to cancel the current operation, go back, stop, or indicates a change of mind.",
    situationRefs: [],
    utterances: [
      "cancel",
      "stop",
      "go back",
      "never mind",
      "abort",
      "no wait",
      "I changed my mind",
      "quit",
      "exit",
      "forget it",
      "don't",
      "actually no",
    ],
    canonicalText:
      "User wants to cancel the current operation, stop what is happening, go back to the previous screen, " +
      "abort an action, or indicates they have changed their mind. " +
      "Examples: cancel, stop, abort, go back, never mind, I changed my mind, quit, exit, forget it, actually no.",
  },
];

export function getBucketById(id: string): VectorBucket | undefined {
  return VECTOR_BUCKETS.find((b) => b.id === id);
}

// ─── Jaccard intent classifier (dev / pre-embedding fallback) ─────────────────
// Same algorithm used in rag-buckets.test.ts. Swap this out with a real
// embedding cosine-search once you wire up pgvector.

const STOPWORDS = new Set([
  "the","a","an","is","it","in","of","to","and","or","for","on","at","by",
  "my","me","do","be","am","are","was","were","has","have","had","will",
  "can","this","that","these","those","so","not","if","no","up","as","did",
  "how","which","who","its","from","with","all","we","you","your","our",
  "he","she","they","their","them","his","her","any","some","get","got",
  "want","wants","would","could","should","may","might","must","let","make",
  "go","put","see","say","said","take","give","know","think","come","look",
  "find","tell","ask","feel","try","leave","call","keep",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function bucketVocab(bucket: VectorBucket): Set<string> {
  return tokenize([bucket.canonicalText, ...bucket.utterances].join(" "));
}

export interface ClassifyResult {
  topId: string;
  topLabel: string;
  topScore: number;
  runnerUpId: string;
  runnerUpScore: number;
}

export function classifyVoiceIntent(query: string): ClassifyResult {
  const qTokens = tokenize(query);
  const scores = VECTOR_BUCKETS.map((b) => ({
    id: b.id,
    label: b.label,
    score: jaccard(qTokens, bucketVocab(b)),
  })).sort((a, b) => b.score - a.score);

  return {
    topId: scores[0].id,
    topLabel: scores[0].label,
    topScore: scores[0].score,
    runnerUpId: scores[1].id,
    runnerUpScore: scores[1].score,
  };
}
