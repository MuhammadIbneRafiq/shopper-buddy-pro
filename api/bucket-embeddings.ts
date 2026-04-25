import type { VercelRequest, VercelResponse } from '@vercel/node';
import { spawn } from 'child_process';

const BEDROCK_URL = 'https://bedrock-runtime.us-east-1.amazonaws.com/model/amazon.nova-2-multimodal-embeddings-v1:0/invoke';

const BUCKETS = [
  { id: 'CHECKOUT_INITIATE', phrase: 'checkout pay now I am done shopping' },
  { id: 'SCAN_PRODUCT',      phrase: 'scan this add this product to my cart' },
  { id: 'BALANCE_CHECK',     phrase: 'what is my balance how much money do I have' },
  { id: 'PAYMENT_STATUS',    phrase: 'is the payment done did it go through' },
  { id: 'ALLERGEN_QUERY',    phrase: 'does this have nuts is this gluten free' },
  { id: 'APP_ONBOARDING',    phrase: 'help how do I use this voice mode button mode' },
  { id: 'BASKET_REVIEW',     phrase: 'show my basket what is in my cart what is my total' },
  { id: 'CANCEL_ABORT',      phrase: 'cancel stop go back never mind abort' },
];

let cache: { id: string; embedding: number[] }[] | null = null;

function synthesizeWav(phrase: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const ff = spawn('ffmpeg', [
      '-f', 'lavfi', '-i', `flite=text='${phrase.replace(/'/g, '')}':voice=rms`,
      '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    ff.stdout.on('data', (c: Buffer) => chunks.push(c));
    ff.stderr.on('data', () => {});
    ff.on('close', (code: number) => {
      if (code !== 0 && chunks.length === 0) return reject(new Error(`ffmpeg exit ${code}`));
      resolve(Buffer.concat(chunks));
    });
    ff.on('error', reject);
  });
}

async function embedAudio(wavBase64: string, token: string): Promise<number[]> {
  const res = await fetch(BEDROCK_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ schemaVersion: 'nova-multimodal-embed-v1', taskType: 'SINGLE_EMBEDDING', singleEmbeddingParams: { embeddingPurpose: 'GENERIC_INDEX', embeddingDimension: 1024, audio: { format: 'wav', source: { bytes: wavBase64 } } } }),
  });
  if (!res.ok) throw new Error(`Bedrock ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return (d as any).embeddings?.[0]?.embedding ?? [];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const token = process.env.VITE_AWS_BEARER_TOKEN_BEDROCK;
  if (!token) return res.status(500).json({ error: 'No token' });
  if (cache) return res.status(200).json({ buckets: cache });
  try {
    cache = await Promise.all(BUCKETS.map(async b => ({
      id: b.id,
      embedding: await embedAudio((await synthesizeWav(b.phrase)).toString('base64'), token),
    })));
    return res.status(200).json({ buckets: cache });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
