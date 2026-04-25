/**
 * Embeds the supermarket catalog using Amazon Titan Text Embeddings v2 (256-dim).
 * Outputs:
 *   src/data/catalog-embeddings.bin  — Float32 binary, shape [N x 256]
 *   src/data/catalog-index.json      — [{id, name, supermarket, unit, price, priceDate, category}]
 *
 * Run: node scripts/embed-catalog.mjs
 * Resumes from last saved position if interrupted.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const __dir = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH  = join(__dir, '../src/data/supermarket-catalog.json');
const INDEX_PATH    = join(__dir, '../src/data/catalog-index.json');
const BIN_PATH      = join(__dir, '../src/data/catalog-embeddings.bin');

const DIMS = 256;
const BATCH = 20;       // parallel requests per wave
const SAVE_EVERY = 500; // checkpoint interval

const client = new BedrockRuntimeClient({ region: 'us-east-1' });

async function embed(text) {
  const cmd = new InvokeModelCommand({
    modelId: 'amazon.titan-embed-text-v2:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({ inputText: text.slice(0, 500), dimensions: DIMS, normalize: true }),
  });
  const res = await client.send(cmd);
  return JSON.parse(Buffer.from(res.body)).embedding;
}

const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf-8'));

// Resume support: load existing index/bin if present
let index = [];
let vectors = [];
if (existsSync(INDEX_PATH) && existsSync(BIN_PATH)) {
  index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
  const buf = readFileSync(BIN_PATH);
  const fa = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  for (let i = 0; i < index.length; i++) {
    vectors.push(Array.from(fa.subarray(i * DIMS, (i + 1) * DIMS)));
  }
  console.log(`Resuming from ${index.length} / ${catalog.length}`);
}

const done = new Set(index.map(p => p.id));
const remaining = catalog.filter(p => !done.has(p.id));
console.log(`To embed: ${remaining.length}`);

function save() {
  const buf = Buffer.allocUnsafe(vectors.length * DIMS * 4);
  for (let i = 0; i < vectors.length; i++) {
    for (let j = 0; j < DIMS; j++) {
      buf.writeFloatLE(vectors[i][j], (i * DIMS + j) * 4);
    }
  }
  writeFileSync(BIN_PATH, buf);
  writeFileSync(INDEX_PATH, JSON.stringify(index));
}

let processed = 0;
for (let i = 0; i < remaining.length; i += BATCH) {
  const batch = remaining.slice(i, i + BATCH);
  const results = await Promise.all(batch.map(p =>
    embed(`${p.name} ${p.unit} ${p.category}`.trim())
      .catch(() => embed(p.name)) // fallback to name only on error
  ));
  for (let k = 0; k < batch.length; k++) {
    const { id, name, supermarket, unit, price, priceDate, category } = batch[k];
    index.push({ id, name, supermarket, unit, price, priceDate, category });
    vectors.push(results[k]);
  }
  processed += batch.length;
  if (processed % SAVE_EVERY === 0 || i + BATCH >= remaining.length) {
    save();
    console.log(`${index.length} / ${catalog.length} embedded`);
  }
}

save();
console.log(`Done. ${index.length} products embedded → catalog-embeddings.bin + catalog-index.json`);
