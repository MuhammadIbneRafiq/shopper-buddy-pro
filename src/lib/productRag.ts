/**
 * RAG pipeline: Claude vision  Titan v2 vector search  Claude grounding
 * Uses bearer token auth (workshop credentials) via direct fetch to Bedrock.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const DIMS = 256;
const TOP_K = 10;
const REGION = 'us-east-1';
const BEDROCK_BASE = `https://bedrock-runtime.${REGION}.amazonaws.com`;

// Load index + embeddings once at startup
const indexPath = join(process.cwd(), 'src/data/catalog-index.json');
const binPath   = join(process.cwd(), 'src/data/catalog-embeddings.bin');

const INDEX: { id: string; name: string; supermarket: string; unit: string; price: number; priceDate: string; category: string }[] = JSON.parse(readFileSync(indexPath, 'utf-8'));
const buf = readFileSync(binPath);
const EMBEDDINGS = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

function getBearer(): string {
  const token = process.env.VITE_AWS_BEARER_TOKEN_BEDROCK || process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (!token) throw new Error('No AWS bearer token found. Set VITE_AWS_BEARER_TOKEN_BEDROCK in .env');
  return token;
}

async function bedrockPost(path: string, body: object): Promise<any> {
  const res = await fetch(`${BEDROCK_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + getBearer(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Bedrock ${path}  HTTP ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json();
}

//  Embed a query string with Titan v2

async function embedText(text: string): Promise<Float32Array> {
  const data = await bedrockPost(
    '/model/amazon.titan-embed-text-v2:0/invoke',
    { inputText: text.slice(0, 500), dimensions: DIMS, normalize: true }
  );
  return new Float32Array(data.embedding as number[]);
}

//  Cosine similarity (vectors are already normalized)

function cosine(a: Float32Array, bOffset: number): number {
  let dot = 0;
  for (let i = 0; i < DIMS; i++) dot += a[i] * EMBEDDINGS[bOffset + i];
  return dot;
}

function vectorSearch(query: Float32Array, k: number) {
  const heap: [number, number][] = [];
  for (let i = 0; i < INDEX.length; i++) {
    const score = cosine(query, i * DIMS);
    if (heap.length < k) {
      heap.push([score, i]);
      if (heap.length === k) heap.sort((a, b) => a[0] - b[0]);
    } else if (score > heap[0][0]) {
      heap[0] = [score, i];
      let j = 0;
      while (true) {
        const l = 2*j+1, r = 2*j+2;
        let m = j;
        if (l < k && heap[l][0] < heap[m][0]) m = l;
        if (r < k && heap[r][0] < heap[m][0]) m = r;
        if (m === j) break;
        [heap[j], heap[m]] = [heap[m], heap[j]]; j = m;
      }
    }
  }
  return heap.sort((a, b) => b[0] - a[0]).map(([score, idx]) => ({ ...INDEX[idx], score }));
}

//  Claude vision: extract product name/brand from image

async function extractFromImage(base64Image: string): Promise<{ name: string; brand: string }> {
  console.log(`[RAG] Vision: sending image to Claude (${(base64Image.length * 0.75 / 1024).toFixed(0)} KB)`);
  const data = await bedrockPost(
    '/model/anthropic.claude-3-haiku-20240307-v1:0/converse',
    {
      system: [{ text: 'Identify grocery products from images. Return ONLY valid JSON: {"name":"...","brand":"..."}' }],
      messages: [{
        role: 'user',
        content: [
          { image: { format: 'jpeg', source: { bytes: base64Image } } },
          { text: 'Identify this product.' },
        ],
      }],
    }
  );
  const raw: string = data.output?.message?.content?.[0]?.text ?? '';
  console.log(`[RAG] Vision raw: ${raw}`);
  const m = raw.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
  return JSON.parse(m?.[0] ?? raw);
}

//  Claude grounding: pick best from top-k candidates

async function groundMatch(extracted: { name: string; brand: string }, candidates: typeof INDEX) {
  const data = await bedrockPost(
    '/model/anthropic.claude-3-haiku-20240307-v1:0/converse',
    {
      system: [{ text: 'Pick the best matching product. Return ONLY JSON: {"index":0,"reasoning":"..."}' }],
      messages: [{
        role: 'user',
        content: [{ text:
          `Scanned: ${JSON.stringify(extracted)}\n\nCandidates:\n${candidates.map((c, i) => `${i}: ${c.name} (${c.supermarket}, ${c.price}, ${c.unit})`).join('\n')}`,
        }],
      }],
    }
  );
  const raw: string = data.output?.message?.content?.[0]?.text ?? '';
  const m = raw.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(m?.[0] ?? raw);
  return { product: candidates[parseInt(parsed.index) ?? 0] ?? candidates[0], reasoning: parsed.reasoning ?? '' };
}

//  Full pipeline

export async function processProductImage(base64Image: string) {
  const t0 = Date.now();
  console.log(`[RAG] Pipeline start, image: ${(base64Image.length * 0.75 / 1024).toFixed(0)} KB`);
  try {
    const extracted = await extractFromImage(base64Image);
    console.log(`[RAG] Vision done (${Date.now()-t0}ms):`, extracted);

    const queryText = `${extracted.brand} ${extracted.name}`.trim();
    console.log(`[RAG] Embedding: "${queryText}"`);
    const queryVec = await embedText(queryText);

    const candidates = vectorSearch(queryVec, TOP_K);
    console.log(`[RAG] Vector search (${Date.now()-t0}ms), top ${TOP_K}:`);
    candidates.forEach((c, i) => console.log(`  ${i+1}. [${c.score?.toFixed(3)}] ${c.supermarket}  ${c.name} ${c.price}`));

    const match = await groundMatch(extracted, candidates);
    console.log(`[RAG] Grounded (${Date.now()-t0}ms): ${match.product.name} ${match.product.price} @ ${match.product.supermarket}`);

    return { success: true, input: extracted, match };
  } catch (e) {
    console.error('[RAG] Error:', e);
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
