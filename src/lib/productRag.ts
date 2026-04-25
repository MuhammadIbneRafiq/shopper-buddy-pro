/**
 * 4-Agent iterative RAG pipeline for grocery product identification.
 *
 * Agent 1 - Visual Decomposer:  rich belief state from image
 * Agent 2 - Ontology Query Builder: 3 queries -> merged candidate pool
 * Agent 3 - Re-vision Verifier:  iterative loop until confident or max rounds
 * Agent 4 - Final Grounder:  image + full belief + candidates -> winner
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const DIMS = 256;
const TOP_K = 10;
const CONFIDENCE_THRESHOLD = 0.75;
const MAX_ROUNDS = 5;
const REGION = 'us-east-1';
const BEDROCK_BASE = `https://bedrock-runtime.${REGION}.amazonaws.com`;

const indexPath = join(process.cwd(), 'src/data/catalog-index.json');
const binPath   = join(process.cwd(), 'src/data/catalog-embeddings.bin');

interface CatalogEntry {
  id: string;
  name: string;
  supermarket: string;
  unit: string;
  price: number;
  priceDate: string;
  category: string;
}

const INDEX: CatalogEntry[] = JSON.parse(readFileSync(indexPath, 'utf-8'));
const buf = readFileSync(binPath);
const EMBEDDINGS = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

// Ontology: top-level category groups from the Dutch supermarket taxonomy
const CATEGORY_ONTOLOGY = [
  'Frisdrank, sappen, water', 'Water', 'Cola', 'Frisdrank',
  'Zuivel, eieren', 'Melk', 'Yoghurt', 'Kaas', 'Boter',
  'Brood', 'Bakkerij', 'Gebak',
  'Vlees', 'Vis', 'Gevogelte',
  'Groente, aardappelen', 'Fruit',
  'Diepvries', 'Snacks', 'Chips',
  'Koek, snoep, chocolade',
  'Koffie, thee', 'Bier, wijn',
  'Huishouden', 'Drogisterij',
  'Pasta', 'Rijst', 'Sauzen', 'Conserven',
  'Ontbijt', 'Muesli', 'Havermout',
  'Huisdier', 'Baby',
];

interface BeliefState {
  name: string;
  brand: string;
  color: string;          // dominant packaging color
  quantity: string;       // e.g. "500ml", "6-pack", "250g"
  packaging: string;      // bottle, can, carton, bag, box, jar, tube
  category_hint: string;  // mapped to ontology
  label_text: string[];   // readable text fragments from label
  confidence: number;     // 0-1, how confident we are in this belief
  no_product: boolean;    // true if no product is visible
}

function getBearer(): string {
  const token = process.env.VITE_AWS_BEARER_TOKEN_BEDROCK || process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (!token) throw new Error('No AWS bearer token. Set VITE_AWS_BEARER_TOKEN_BEDROCK in .env');
  return token;
}

async function bedrockPost(path: string, body: object): Promise<any> {
  const res = await fetch(`${BEDROCK_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getBearer() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Bedrock ${path} -> HTTP ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.json();
}

async function claude(system: string, userText: string, imageBase64?: string): Promise<string> {
  const content: any[] = [];
  if (imageBase64) {
    content.push({ image: { format: 'jpeg', source: { bytes: imageBase64 } } });
  }
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

function cosineSearch(query: Float32Array, k: number): (CatalogEntry & { score: number })[] {
  const heap: [number, number][] = [];
  for (let i = 0; i < INDEX.length; i++) {
    let dot = 0;
    for (let j = 0; j < DIMS; j++) dot += query[j] * EMBEDDINGS[i * DIMS + j];
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
  return heap.sort((a, b) => b[0] - a[0]).map(([score, idx]) => ({ ...INDEX[idx], score }));
}

function parseJSON<T>(raw: string): T {
  const m = raw.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
  return JSON.parse(m?.[0] ?? raw) as T;
}

// ============================================================
// AGENT 1: Visual Decomposer
// ============================================================
async function agent1_visualDecompose(imageBase64: string): Promise<BeliefState> {
  console.log('[Agent1] Visual decomposition...');

  const system = `You are a grocery product visual analyst. Extract detailed product attributes from images.
Return ONLY valid JSON with these exact fields:
{
  "name": "product name",
  "brand": "brand name or empty string",
  "color": "dominant packaging color (e.g. red, blue, white, green, yellow, orange, purple, black)",
  "quantity": "volume/weight/count (e.g. 500ml, 250g, 6-pack, 1L, 400g)",
  "packaging": "one of: bottle, can, carton, bag, box, jar, tube, sachet, tray, unknown",
  "category_hint": "most specific category from: ${CATEGORY_ONTOLOGY.slice(0, 20).join(', ')}",
  "label_text": ["array", "of", "readable", "text", "fragments", "from", "label"],
  "confidence": 0.0,
  "no_product": false
}
Set no_product=true and confidence=0 if no grocery product is clearly visible.
Set confidence between 0.0 and 1.0 based on image clarity and certainty.`;

  const raw = await claude(system, 'Analyze this product image in detail.', imageBase64);
  console.log('[Agent1] Raw:', raw.slice(0, 200));

  try {
    const belief = parseJSON<BeliefState>(raw);
    belief.label_text = belief.label_text ?? [];
    belief.confidence = Math.max(0, Math.min(1, belief.confidence ?? 0));
    belief.no_product = belief.no_product ?? false;
    console.log('[Agent1] Belief:', JSON.stringify({ ...belief, label_text: belief.label_text.slice(0, 3) }));
    return belief;
  } catch {
    console.warn('[Agent1] Parse failed, returning no_product belief');
    return { name: '', brand: '', color: '', quantity: '', packaging: 'unknown',
             category_hint: '', label_text: [], confidence: 0, no_product: true };
  }
}

// ============================================================
// AGENT 2: Ontology-aware Query Builder
// ============================================================
async function agent2_buildCandidatePool(belief: BeliefState): Promise<(CatalogEntry & { score: number })[]> {
  console.log('[Agent2] Building candidate pool from 3 queries...');

  // Query A: brand + name (classic)
  const queryA = `${belief.brand} ${belief.name}`.trim();

  // Query B: ontology category + packaging + quantity
  const queryB = `${belief.category_hint} ${belief.packaging} ${belief.quantity}`.trim();

  // Query C: label text fragments + color
  const queryC = [...belief.label_text.slice(0, 4), belief.color, belief.quantity].filter(Boolean).join(' ');

  console.log('[Agent2] Query A:', queryA);
  console.log('[Agent2] Query B:', queryB);
  console.log('[Agent2] Query C:', queryC);

  const queries = [queryA, queryB, queryC].filter(q => q.length > 1);
  const results = await Promise.all(queries.map(q => embedText(q).then(v => cosineSearch(v, TOP_K))));

  // Merge and deduplicate by id, keeping highest score
  const seen = new Map<string, CatalogEntry & { score: number }>();
  for (const batch of results) {
    for (const item of batch) {
      const existing = seen.get(item.id);
      if (!existing || item.score > existing.score) seen.set(item.id, item);
    }
  }

  const pool = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 30);
  console.log(`[Agent2] Pool: ${pool.length} candidates (top: ${pool[0]?.name} @ ${pool[0]?.score?.toFixed(3)})`);
  return pool;
}

// ============================================================
// AGENT 3: Re-vision Verifier (iterative)
// ============================================================
async function agent3_revisionLoop(
  imageBase64: string,
  belief: BeliefState,
  pool: (CatalogEntry & { score: number })[]
): Promise<{ belief: BeliefState; pool: (CatalogEntry & { score: number })[] }> {

  let currentBelief = { ...belief };
  let currentPool = [...pool];
  let round = 0;

  while (round < MAX_ROUNDS && currentBelief.confidence < CONFIDENCE_THRESHOLD) {
    round++;
    console.log(`[Agent3] Round ${round}/${MAX_ROUNDS}, confidence=${currentBelief.confidence.toFixed(2)}`);

    const top5 = currentPool.slice(0, 5);
    const candidateList = top5.map((c, i) =>
      `${i}: ${c.name} | ${c.supermarket} | ${c.unit} | ${c.category.split('\\').pop()}`
    ).join('\n');

    const system = `You are a grocery product verification agent. You see an image and a list of candidate products.
Your job is to:
1. Check if any candidate matches the image
2. If not, identify what is WRONG with the current belief and correct it
3. Return updated belief state

Return ONLY valid JSON:
{
  "match_found": true/false,
  "best_match_index": 0,
  "updated_belief": {
    "name": "...", "brand": "...", "color": "...", "quantity": "...",
    "packaging": "...", "category_hint": "...", "label_text": [...],
    "confidence": 0.0, "no_product": false
  },
  "correction_reason": "what was wrong and what was corrected"
}`;

    const prompt = `Current belief: ${JSON.stringify({ name: currentBelief.name, brand: currentBelief.brand, quantity: currentBelief.quantity, packaging: currentBelief.packaging, color: currentBelief.color })}

Top candidates:
${candidateList}

Does the image match any candidate? If not, correct the belief.`;

    const raw = await claude(system, prompt, imageBase64);
    console.log(`[Agent3] Round ${round} raw:`, raw.slice(0, 200));

    try {
      const result = parseJSON<{
        match_found: boolean;
        best_match_index: number;
        updated_belief: BeliefState;
        correction_reason: string;
      }>(raw);

      console.log(`[Agent3] Round ${round}: match=${result.match_found}, reason="${result.correction_reason}"`);

      // Update belief
      if (result.updated_belief) {
        currentBelief = {
          ...result.updated_belief,
          confidence: Math.max(0, Math.min(1, result.updated_belief.confidence ?? currentBelief.confidence)),
          no_product: result.updated_belief.no_product ?? false,
          label_text: result.updated_belief.label_text ?? currentBelief.label_text,
        };
      }

      // If match found, boost confidence and stop early
      if (result.match_found && result.best_match_index >= 0 && result.best_match_index < top5.length) {
        currentBelief.confidence = Math.max(currentBelief.confidence, CONFIDENCE_THRESHOLD);
        // Promote the matched candidate to top of pool
        const matched = top5[result.best_match_index];
        currentPool = [matched, ...currentPool.filter(c => c.id !== matched.id)];
        console.log(`[Agent3] Match found: ${matched.name}, stopping loop`);
        break;
      }

      // Re-embed with updated belief and rebuild pool
      if (!currentBelief.no_product) {
        const newPool = await agent2_buildCandidatePool(currentBelief);
        currentPool = newPool;
      }

    } catch (e) {
      console.warn(`[Agent3] Round ${round} parse error:`, e);
      break;
    }
  }

  console.log(`[Agent3] Done after ${round} rounds, final confidence=${currentBelief.confidence.toFixed(2)}`);
  return { belief: currentBelief, pool: currentPool };
}

// ============================================================
// AGENT 4: Final Grounder
// ============================================================
async function agent4_ground(
  imageBase64: string,
  belief: BeliefState,
  pool: (CatalogEntry & { score: number })[]
): Promise<{ product: CatalogEntry; confidence: number; reasoning: string } | null> {

  console.log('[Agent4] Final grounding...');

  const top10 = pool.slice(0, 10);
  const candidateList = top10.map((c, i) =>
    `${i}: ${c.name} | ${c.supermarket} | EUR ${c.price} | ${c.unit} | ${c.category.split('\\').pop()}`
  ).join('\n');

  const system = `You are a final product matching agent. You have a product image, a detailed belief state, and candidate products.
Pick the single best match or return no_match if none fit.
Return ONLY valid JSON:
{
  "index": 0,
  "confidence": 0.0,
  "no_match": false,
  "reasoning": "why this is the best match"
}
Set no_match=true if no candidate is a reasonable match for the image.`;

  const prompt = `Belief state: ${JSON.stringify({
    name: belief.name, brand: belief.brand, quantity: belief.quantity,
    packaging: belief.packaging, color: belief.color, category: belief.category_hint,
    label_text: belief.label_text.slice(0, 5),
  })}

Candidates:
${candidateList}

Which candidate best matches the image and belief state?`;

  const raw = await claude(system, prompt, imageBase64);
  console.log('[Agent4] Raw:', raw.slice(0, 200));

  try {
    const result = parseJSON<{ index: number; confidence: number; no_match: boolean; reasoning: string }>(raw);

    if (result.no_match) {
      console.log('[Agent4] No match found');
      return null;
    }

    const idx = Math.max(0, Math.min(top10.length - 1, result.index ?? 0));
    const product = top10[idx];
    console.log(`[Agent4] Winner: ${product.name} @ ${product.supermarket} EUR ${product.price} (confidence=${result.confidence?.toFixed(2)})`);
    return { product, confidence: result.confidence ?? 0, reasoning: result.reasoning ?? '' };
  } catch {
    // Fallback: return top candidate
    const product = top10[0];
    if (!product) return null;
    console.log('[Agent4] Parse failed, using top candidate:', product.name);
    return { product, confidence: 0.3, reasoning: 'Fallback to top vector search result' };
  }
}

// ============================================================
// Full pipeline
// ============================================================
export async function processProductImage(base64Image: string) {
  const t0 = Date.now();
  console.log(`[Pipeline] Start, image: ${(base64Image.length * 0.75 / 1024).toFixed(0)} KB`);

  try {
    // Agent 1: Visual decomposition
    const belief = await agent1_visualDecompose(base64Image);
    console.log(`[Pipeline] Agent1 done (${Date.now()-t0}ms)`);

    // Hard stop: no product visible
    if (belief.no_product || (!belief.name && !belief.brand && belief.label_text.length === 0)) {
      console.log('[Pipeline] No product detected, refusing to guess');
      return { success: false, no_product: true, error: 'No grocery product visible in the image. Please point the camera at a product.' };
    }

    // Agent 2: Build initial candidate pool
    let pool = await agent2_buildCandidatePool(belief);
    console.log(`[Pipeline] Agent2 done (${Date.now()-t0}ms), pool size: ${pool.length}`);

    // Agent 3: Iterative re-vision if confidence is low
    let finalBelief = belief;
    if (belief.confidence < CONFIDENCE_THRESHOLD) {
      const revised = await agent3_revisionLoop(base64Image, belief, pool);
      finalBelief = revised.belief;
      pool = revised.pool;
      console.log(`[Pipeline] Agent3 done (${Date.now()-t0}ms)`);

      // Re-check no_product after revision
      if (finalBelief.no_product) {
        return { success: false, no_product: true, error: 'No grocery product could be identified after multiple attempts. Please try again with better lighting.' };
      }
    }

    // Agent 4: Final grounding
    const match = await agent4_ground(base64Image, finalBelief, pool);
    console.log(`[Pipeline] Agent4 done (${Date.now()-t0}ms)`);

    if (!match) {
      return { success: false, no_product: false, error: 'Product detected but could not be matched to any item in the catalog.' };
    }

    console.log(`[Pipeline] Total: ${Date.now()-t0}ms | ${match.product.name} @ ${match.product.supermarket} EUR ${match.product.price}`);
    return {
      success: true,
      input: { name: finalBelief.name, brand: finalBelief.brand },
      belief: finalBelief,
      match,
    };

  } catch (e) {
    console.error('[Pipeline] Error:', e);
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
