import { BedrockRuntimeClient, ConverseCommand, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const client = new BedrockRuntimeClient({ region: 'us-east-1' });
const DIMS = 256;

const INDEX = JSON.parse(readFileSync(join(__dir, '../src/data/catalog-index.json'), 'utf-8'));
const buf = readFileSync(join(__dir, '../src/data/catalog-embeddings.bin'));
const EMBEDDINGS = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

async function embedText(text) {
  const r = await client.send(new InvokeModelCommand({
    modelId: 'amazon.titan-embed-text-v2:0',
    contentType: 'application/json', accept: 'application/json',
    body: JSON.stringify({ inputText: text.slice(0, 500), dimensions: DIMS, normalize: true }),
  }));
  return new Float32Array(JSON.parse(Buffer.from(r.body)).embedding);
}

function vectorSearch(q, k = 5) {
  const heap = [];
  for (let i = 0; i < INDEX.length; i++) {
    let dot = 0;
    for (let j = 0; j < DIMS; j++) dot += q[j] * EMBEDDINGS[i * DIMS + j];
    if (heap.length < k) { heap.push([dot, i]); if (heap.length === k) heap.sort((a,b)=>a[0]-b[0]); }
    else if (dot > heap[0][0]) { heap[0] = [dot, i]; heap.sort((a,b)=>a[0]-b[0]); }
  }
  return heap.sort((a,b)=>b[0]-a[0]).map(([s,i]) => ({ ...INDEX[i], score: s.toFixed(3) }));
}

// ── Test 1: Vision with a minimal JPEG (1x1 white pixel) ─────────────────
console.log('\n=== TEST 1: Vision API call ===');
// Minimal valid JPEG
const minJpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k=', 'base64');
const imageBytes = new Uint8Array(minJpeg);
console.log(`Sending ${imageBytes.length} byte JPEG to Claude vision...`);

try {
  const res = await client.send(new ConverseCommand({
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
    system: [{ text: 'Identify grocery products from images. Return ONLY valid JSON: {"name":"...","brand":"..."}' }],
    messages: [{ role: 'user', content: [
      { image: { format: 'jpeg', source: { bytes: imageBytes } } },
      { text: 'Identify this product.' },
    ]}],
  }));
  console.log('Vision response:', res.output?.message?.content?.[0]?.text);
  console.log('✓ Vision API works');
} catch (e) {
  console.error('✗ Vision API error:', e.message);
}

// ── Test 2: Vector search with text queries ───────────────────────────────
console.log('\n=== TEST 2: Vector search ===');
const queries = [
  'Campina roomboter gezouten',
  'Activia yoghurt naturel',
  'Coca Cola blikje',
  'AH biologische halfvolle melk',
];

for (const q of queries) {
  const vec = await embedText(q);
  const results = vectorSearch(vec, 3);
  console.log(`\nQuery: "${q}"`);
  results.forEach(r => console.log(`  [${r.score}] ${r.supermarket} — ${r.name} €${r.price} (${r.unit})`));
}

// ── Test 3: Full pipeline with a text-only mock (no real image) ───────────
console.log('\n=== TEST 3: Full pipeline mock (text-only) ===');
const mockExtracted = { name: 'Halfvolle melk', brand: 'Campina' };
console.log('Mock extracted:', mockExtracted);
const mockQuery = `${mockExtracted.brand} ${mockExtracted.name}`;
const mockVec = await embedText(mockQuery);
const mockCandidates = vectorSearch(mockVec, 5);
console.log('Top candidates:');
mockCandidates.forEach((c, i) => console.log(`  ${i}: [${c.score}] ${c.supermarket} — ${c.name} €${c.price}`));

const groundRes = await client.send(new ConverseCommand({
  modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
  system: [{ text: 'Pick the best matching product. Return ONLY JSON: {"index":0,"reasoning":"..."}' }],
  messages: [{ role: 'user', content: [{ text:
    `Scanned: ${JSON.stringify(mockExtracted)}\n\nCandidates:\n${mockCandidates.map((c,i) => `${i}: ${c.name} (${c.supermarket}, €${c.price}, ${c.unit})`).join('\n')}`
  }]}],
}));
const gRaw = groundRes.output?.message?.content?.[0]?.text ?? '';
const gm = gRaw.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
const grounded = JSON.parse(gm?.[0] ?? gRaw);
const winner = mockCandidates[parseInt(grounded.index) ?? 0];
console.log(`\nGrounded winner: ${winner?.name} €${winner?.price} @ ${winner?.supermarket}`);
console.log(`Reasoning: ${grounded.reasoning}`);
console.log('\n✓ Full pipeline works');
