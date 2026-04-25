import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'fs';
import { join } from 'path';

// In Vercel, includeFiles copies src/data/ next to the function bundle.
// Locally (Vite SSR), cwd() is the project root.
const DATA_DIR = process.env.VERCEL
  ? join(__dirname, 'src/data')
  : join(process.cwd(), 'src/data');

let INDEX: any[] | null = null;
let EMBEDDINGS: Float32Array | null = null;

function loadData() {
  if (INDEX && EMBEDDINGS) return;
  INDEX = JSON.parse(readFileSync(join(DATA_DIR, 'catalog-index.json'), 'utf-8'));
  const buf = readFileSync(join(DATA_DIR, 'catalog-embeddings.bin'));
  EMBEDDINGS = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

const DIMS = 256;
const TOP_K = 10;
const CONFIDENCE_THRESHOLD = 0.75;
const MAX_ROUNDS = 5;
const BEDROCK_BASE = 'https://bedrock-runtime.us-east-1.amazonaws.com';

const CATEGORY_ONTOLOGY = [
  'Frisdrank, sappen, water', 'Water', 'Cola', 'Frisdrank',
  'Zuivel, eieren', 'Melk', 'Yoghurt', 'Kaas', 'Boter',
  'Brood', 'Bakkerij', 'Groente, aardappelen', 'Fruit',
  'Diepvries', 'Snacks', 'Chips', 'Koek, snoep, chocolade',
  'Koffie, thee', 'Bier, wijn', 'Huishouden', 'Drogisterij',
  'Pasta', 'Rijst', 'Sauzen', 'Conserven', 'Huisdier',
];

function getBearer(): string {
  const token = process.env.VITE_AWS_BEARER_TOKEN_BEDROCK || process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (!token) throw new Error('No AWS bearer token configured');
  return token;
}

async function bedrockPost(path: string, body: object): Promise<any> {
  const res = await fetch(`${BEDROCK_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getBearer() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Bedrock ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function claude(system: string, userText: string, imageBase64?: string): Promise<string> {
  const content: any[] = [];
  if (imageBase64) content.push({ image: { format: 'jpeg', source: { bytes: imageBase64 } } });
  content.push({ text: userText });
  const data = await bedrockPost('/model/anthropic.claude-3-haiku-20240307-v1:0/converse', {
    system: [{ text: system }],
    messages: [{ role: 'user', content }],
  });
  return data.output?.message?.content?.[0]?.text ?? '';
}

async function embedText(text: string): Promise<Float32Array> {
  const data = await bedrockPost('/model/amazon.titan-embed-text-v2:0/invoke', {
    inputText: text.slice(0, 500), dimensions: DIMS, normalize: true,
  });
  return new Float32Array(data.embedding as number[]);
}

function cosineSearch(query: Float32Array, k: number) {
  const emb = EMBEDDINGS!;
  const idx = INDEX!;
  const heap: [number, number][] = [];
  for (let i = 0; i < idx.length; i++) {
    let dot = 0;
    for (let j = 0; j < DIMS; j++) dot += query[j] * emb[i * DIMS + j];
    if (heap.length < k) {
      heap.push([dot, i]);
      if (heap.length === k) heap.sort((a, b) => a[0] - b[0]);
    } else if (dot > heap[0][0]) {
      heap[0] = [dot, i];
      let j = 0;
      while (true) {
        const l = 2*j+1, r = 2*j+2; let m = j;
        if (l < k && heap[l][0] < heap[m][0]) m = l;
        if (r < k && heap[r][0] < heap[m][0]) m = r;
        if (m === j) break;
        [heap[j], heap[m]] = [heap[m], heap[j]]; j = m;
      }
    }
  }
  return heap.sort((a, b) => b[0] - a[0]).map(([score, i]) => ({ ...idx[i], score }));
}

function parseJSON<T>(raw: string): T {
  const m = raw.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
  return JSON.parse(m?.[0] ?? raw) as T;
}

interface BeliefState {
  name: string; brand: string; color: string; quantity: string;
  packaging: string; category_hint: string; label_text: string[];
  confidence: number; no_product: boolean;
}

async function agent1(imageBase64: string): Promise<BeliefState> {
  const raw = await claude(
    `You are a grocery product visual analyst. Extract product attributes from the image.
Return ONLY valid JSON: {"name":"...","brand":"...","color":"dominant packaging color","quantity":"e.g. 500ml","packaging":"bottle|can|carton|bag|box|jar|tube|unknown","category_hint":"from: ${CATEGORY_ONTOLOGY.slice(0,15).join(', ')}","label_text":["text","fragments"],"confidence":0.0,"no_product":false}
Set no_product=true and confidence=0 if no grocery product is visible.`,
    'Analyze this product image.',
    imageBase64
  );
  try {
    const b = parseJSON<BeliefState>(raw);
    return { ...b, label_text: b.label_text ?? [], confidence: Math.max(0, Math.min(1, b.confidence ?? 0)), no_product: b.no_product ?? false };
  } catch {
    return { name: '', brand: '', color: '', quantity: '', packaging: 'unknown', category_hint: '', label_text: [], confidence: 0, no_product: true };
  }
}

async function agent2(belief: BeliefState) {
  const queries = [
    `${belief.brand} ${belief.name}`.trim(),
    `${belief.category_hint} ${belief.packaging} ${belief.quantity}`.trim(),
    [...belief.label_text.slice(0, 4), belief.color, belief.quantity].filter(Boolean).join(' '),
  ].filter(q => q.length > 1);

  const results = await Promise.all(queries.map(q => embedText(q).then(v => cosineSearch(v, TOP_K))));
  const seen = new Map<string, any>();
  for (const batch of results)
    for (const item of batch)
      if (!seen.has(item.id) || item.score > seen.get(item.id).score) seen.set(item.id, item);
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 30);
}

async function agent3(imageBase64: string, belief: BeliefState, pool: any[]) {
  let b = { ...belief };
  let p = [...pool];
  for (let round = 0; round < MAX_ROUNDS && b.confidence < CONFIDENCE_THRESHOLD; round++) {
    const top5 = p.slice(0, 5);
    const raw = await claude(
      `You are a grocery product verification agent. Check if any candidate matches the image and correct the belief if needed.
Return ONLY JSON: {"match_found":false,"best_match_index":0,"updated_belief":{...same fields as belief...},"correction_reason":"..."}`,
      `Current belief: ${JSON.stringify({ name: b.name, brand: b.brand, quantity: b.quantity, packaging: b.packaging, color: b.color })}
Top candidates:\n${top5.map((c, i) => `${i}: ${c.name} | ${c.supermarket} | ${c.unit}`).join('\n')}
Does the image match any candidate? Correct the belief if not.`,
      imageBase64
    );
    try {
      const r = parseJSON<any>(raw);
      if (r.updated_belief) b = { ...r.updated_belief, confidence: Math.max(0, Math.min(1, r.updated_belief.confidence ?? b.confidence)), no_product: r.updated_belief.no_product ?? false, label_text: r.updated_belief.label_text ?? b.label_text };
      if (r.match_found && r.best_match_index >= 0 && r.best_match_index < top5.length) {
        b.confidence = Math.max(b.confidence, CONFIDENCE_THRESHOLD);
        const matched = top5[r.best_match_index];
        p = [matched, ...p.filter(c => c.id !== matched.id)];
        break;
      }
      if (!b.no_product) p = await agent2(b);
    } catch { break; }
  }
  return { belief: b, pool: p };
}

async function agent4(imageBase64: string, belief: BeliefState, pool: any[]) {
  const top10 = pool.slice(0, 10);
  const raw = await claude(
    `Pick the best matching product or set no_match=true. Return ONLY JSON: {"index":0,"confidence":0.0,"no_match":false,"reasoning":"..."}`,
    `Belief: ${JSON.stringify({ name: belief.name, brand: belief.brand, quantity: belief.quantity, packaging: belief.packaging, color: belief.color, category: belief.category_hint })}
Candidates:\n${top10.map((c, i) => `${i}: ${c.name} | ${c.supermarket} | EUR ${c.price} | ${c.unit}`).join('\n')}`,
    imageBase64
  );
  try {
    const r = parseJSON<any>(raw);
    if (r.no_match) return null;
    const idx = Math.max(0, Math.min(top10.length - 1, r.index ?? 0));
    return { product: top10[idx], confidence: r.confidence ?? 0, reasoning: r.reasoning ?? '' };
  } catch {
    return top10[0] ? { product: top10[0], confidence: 0.3, reasoning: 'Fallback to top result' } : null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    loadData();
    const { imageBase64 } = req.body as { imageBase64: string };
    if (!imageBase64) return res.status(400).json({ success: false, error: 'Missing imageBase64' });

    const belief = await agent1(imageBase64);
    if (belief.no_product || (!belief.name && !belief.brand && belief.label_text.length === 0)) {
      return res.json({ success: false, no_product: true, error: 'No grocery product visible. Please point the camera at a product.' });
    }

    let pool = await agent2(belief);
    let finalBelief = belief;

    if (belief.confidence < CONFIDENCE_THRESHOLD) {
      const revised = await agent3(imageBase64, belief, pool);
      finalBelief = revised.belief;
      pool = revised.pool;
      if (finalBelief.no_product) {
        return res.json({ success: false, no_product: true, error: 'No product identified after multiple attempts. Try again with better lighting.' });
      }
    }

    const match = await agent4(imageBase64, finalBelief, pool);
    if (!match) return res.json({ success: false, no_product: false, error: 'Product detected but not matched in catalog.' });

    return res.json({ success: true, input: { name: finalBelief.name, brand: finalBelief.brand }, belief: finalBelief, match });
  } catch (e) {
    console.error('[RAG]', e);
    return res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
  }
}
