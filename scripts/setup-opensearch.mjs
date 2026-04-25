/**
 * Sets up OpenSearch Serverless collection + vector index,
 * then bulk-uploads all product embeddings.
 * Run once: node scripts/setup-opensearch.mjs
 */
import { OpenSearchServerlessClient, CreateCollectionCommand, CreateSecurityPolicyCommand, CreateAccessPolicyCommand, BatchGetCollectionCommand } from '@aws-sdk/client-opensearchserverless';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const REGION = 'us-east-1';
const COLLECTION = 'shopper-buddy-products';
const INDEX = 'products';
const DIMS = 256;
const BATCH_SIZE = 500;

const aossClient = new OpenSearchServerlessClient({ region: REGION });

// ── 1. Get caller identity for access policy ─────────────────────────────
const sts = new STSClient({ region: REGION });
const identity = await sts.send(new GetCallerIdentityCommand({}));
const accountId = identity.Account;
const userArn = identity.Arn;
console.log(`Account: ${accountId}, Principal: ${userArn}`);

// ── 2. Create encryption policy ───────────────────────────────────────────
try {
  await aossClient.send(new CreateSecurityPolicyCommand({
    name: `${COLLECTION}-enc`,
    type: 'encryption',
    policy: JSON.stringify({
      Rules: [{ ResourceType: 'collection', Resource: [`collection/${COLLECTION}`] }],
      AWSOwnedKey: true,
    }),
  }));
  console.log('Encryption policy created');
} catch (e) { if (!e.message.includes('already exists')) throw e; console.log('Encryption policy exists'); }

// ── 3. Create network policy (public access) ──────────────────────────────
try {
  await aossClient.send(new CreateSecurityPolicyCommand({
    name: `${COLLECTION}-net`,
    type: 'network',
    policy: JSON.stringify([{
      Rules: [
        { ResourceType: 'collection', Resource: [`collection/${COLLECTION}`] },
        { ResourceType: 'dashboard', Resource: [`collection/${COLLECTION}`] },
      ],
      AllowFromPublic: true,
    }]),
  }));
  console.log('Network policy created');
} catch (e) { if (!e.message.includes('already exists')) throw e; console.log('Network policy exists'); }

// ── 4. Create data access policy ─────────────────────────────────────────
try {
  await aossClient.send(new CreateAccessPolicyCommand({
    name: `${COLLECTION}-access`,
    type: 'data',
    policy: JSON.stringify([{
      Rules: [
        { ResourceType: 'collection', Resource: [`collection/${COLLECTION}`], Permission: ['aoss:*'] },
        { ResourceType: 'index', Resource: [`index/${COLLECTION}/*`], Permission: ['aoss:*'] },
      ],
      Principal: [userArn],
    }]),
  }));
  console.log('Access policy created');
} catch (e) { if (!e.message.includes('already exists')) throw e; console.log('Access policy exists'); }

// ── 5. Create collection ──────────────────────────────────────────────────
let endpoint;
try {
  const res = await aossClient.send(new CreateCollectionCommand({
    name: COLLECTION,
    type: 'VECTORSEARCH',
    description: 'Shopper Buddy product embeddings',
  }));
  console.log('Collection created, waiting for ACTIVE...');
} catch (e) {
  if (!e.message.includes('already exists')) throw e;
  console.log('Collection exists');
}

// Wait for ACTIVE
while (true) {
  const res = await aossClient.send(new BatchGetCollectionCommand({ names: [COLLECTION] }));
  const col = res.collectionDetails?.[0];
  console.log(`Collection status: ${col?.status}`);
  if (col?.status === 'ACTIVE') { endpoint = col.collectionEndpoint; break; }
  if (col?.status === 'FAILED') throw new Error('Collection failed');
  await new Promise(r => setTimeout(r, 10000));
}
console.log(`Endpoint: ${endpoint}`);

// ── Helper: signed fetch to OpenSearch ───────────────────────────────────
const creds = defaultProvider();
async function signedFetch(method, path, body) {
  const url = new URL(path, endpoint);
  const bodyStr = body ? JSON.stringify(body) : undefined;
  const req = {
    method,
    hostname: url.hostname,
    path: url.pathname + url.search,
    headers: { host: url.hostname, 'content-type': 'application/json' },
    body: bodyStr,
  };
  const signer = new SignatureV4({ credentials: creds, region: REGION, service: 'aoss', sha256: Sha256 });
  const signed = await signer.sign(req);
  const res = await fetch(`${endpoint}${url.pathname}${url.search}`, {
    method,
    headers: signed.headers,
    body: bodyStr,
  });
  return res.json();
}

// ── 6. Create vector index ────────────────────────────────────────────────
const indexExists = await signedFetch('HEAD', `/${INDEX}`, null).catch(() => null);
const createRes = await signedFetch('PUT', `/${INDEX}`, {
  settings: { index: { knn: true } },
  mappings: { properties: {
    id:          { type: 'keyword' },
    name:        { type: 'text' },
    supermarket: { type: 'keyword' },
    unit:        { type: 'keyword' },
    price:       { type: 'float' },
    priceDate:   { type: 'keyword' },
    category:    { type: 'text' },
    embedding:   { type: 'knn_vector', dimension: DIMS, method: { name: 'hnsw', engine: 'faiss', space_type: 'innerproduct' } },
  }},
});
console.log('Index:', JSON.stringify(createRes));

// ── 7. Bulk upload ────────────────────────────────────────────────────────
const catalog = JSON.parse(readFileSync(join(__dir, '../src/data/catalog-index.json'), 'utf-8'));
const embBuf = readFileSync(join(__dir, '../src/data/catalog-embeddings.bin'));
const EMBEDDINGS = new Float32Array(embBuf.buffer, embBuf.byteOffset, embBuf.byteLength / 4);

console.log(`Uploading ${catalog.length} products in batches of ${BATCH_SIZE}...`);
let uploaded = 0;
for (let i = 0; i < catalog.length; i += BATCH_SIZE) {
  const batch = catalog.slice(i, i + BATCH_SIZE);
  const body = batch.flatMap((p, k) => [
    { index: { _index: INDEX, _id: p.id } },
    {
      id: p.id, name: p.name, supermarket: p.supermarket,
      unit: p.unit, price: p.price, priceDate: p.priceDate, category: p.category,
      embedding: Array.from(EMBEDDINGS.subarray((i + k) * DIMS, (i + k + 1) * DIMS)),
    },
  ]);
  const res = await signedFetch('POST', '/_bulk', null);
  // Send raw ndjson
  const ndjson = body.map(l => JSON.stringify(l)).join('\n') + '\n';
  const url = new URL('/_bulk', endpoint);
  const signer = new SignatureV4({ credentials: creds, region: REGION, service: 'aoss', sha256: Sha256 });
  const signed = await signer.sign({
    method: 'POST', hostname: url.hostname, path: '/_bulk',
    headers: { host: url.hostname, 'content-type': 'application/x-ndjson' },
    body: ndjson,
  });
  const r = await fetch(`${endpoint}/_bulk`, { method: 'POST', headers: signed.headers, body: ndjson });
  const json = await r.json();
  if (json.errors) console.warn(`Batch ${i}: some errors`);
  uploaded += batch.length;
  if (uploaded % 5000 === 0 || uploaded === catalog.length) console.log(`${uploaded}/${catalog.length} uploaded`);
}

console.log(`\nDone! Collection endpoint: ${endpoint}`);
console.log(`Add to .env: VITE_OPENSEARCH_ENDPOINT=${endpoint}`);
