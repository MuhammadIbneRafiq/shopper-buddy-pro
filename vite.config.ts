import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const BEDROCK_EMBED_URL = 'https://bedrock-runtime.us-east-1.amazonaws.com/model/amazon.nova-2-multimodal-embeddings-v1:0/invoke';

const BUCKETS = [
  { id: 'CHECKOUT_INITIATE', text: "User is ready to complete their shopping and wants to pay. Examples: pay now, checkout, I'm done shopping, finish and pay, let's pay, done, ready to pay." },
  { id: 'SCAN_PRODUCT', text: "User wants to scan a product barcode or add an item to their cart. Examples: scan this, add this product, scan the barcode, add it, what's the price, put it in my cart." },
  { id: 'BALANCE_CHECK', text: "User wants to check their account balance or verify they have enough funds. Examples: what's my balance, how much money do I have, can I afford this, check my account." },
  { id: 'PAYMENT_STATUS', text: "User is asking about the status of a payment being processed. Examples: is the payment done, did it go through, payment status, is it processing." },
  { id: 'ALLERGEN_QUERY', text: "User wants to know about allergens or dietary suitability of a product. Examples: does this have nuts, is this gluten free, any dairy in this, is this vegan." },
  { id: 'APP_ONBOARDING', text: "User needs onboarding help or wants to switch input mode. Examples: button mode, voice mode, how do I use this, help, get started, instructions." },
  { id: 'BASKET_REVIEW', text: "User wants to review basket contents, see total, or remove an item. Examples: show my basket, what's in my cart, remove the last item, what's my total." },
  { id: 'CANCEL_ABORT', text: "User wants to cancel the current operation or go back. Examples: cancel, stop, abort, go back, never mind, I changed my mind, quit." },
];

let bucketCache: { id: string; embedding: number[] }[] | null = null;

function readBody(req: any): Promise<string> {
  return new Promise(r => { let b = ''; req.on('data', (c: any) => b += c); req.on('end', () => r(b)); });
}

async function bedrockEmbed(payload: object, token: string): Promise<number[]> {
  const res = await fetch(BEDROCK_EMBED_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Bedrock ${res.status}: ${await res.text()}`);
  const d = await res.json() as any;
  return d.embeddings?.[0]?.embedding ?? [];
}

function ragApiPlugin() {
  return {
    name: 'rag-api',
    configureServer(server: any) {
      const env = loadEnv('development', process.cwd(), '');
      Object.assign(process.env, env);

      server.middlewares.use('/api/rag', (req: any, res: any) => {
        if (req.method !== 'POST') return;
        readBody(req).then(async body => {
          try {
            const { processProductImage } = await server.ssrLoadModule('/src/lib/productRag.ts');
            const { imageBase64 } = JSON.parse(body);
            const result = await processProductImage(imageBase64);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
          } catch (e: any) {
            console.error('[RAG API]', e);
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });

      server.middlewares.use('/api/embed-audio', (req: any, res: any) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        readBody(req).then(async body => {
          try {
            const { audioBase64 } = JSON.parse(body);
            const token = process.env.VITE_AWS_BEARER_TOKEN_BEDROCK;
            if (!token) throw new Error('No token');
            const embedding = await bedrockEmbed({
              schemaVersion: 'nova-multimodal-embed-v1',
              taskType: 'SINGLE_EMBEDDING',
              singleEmbeddingParams: { embeddingPurpose: 'GENERIC_INDEX', embeddingDimension: 1024, audio: { format: 'wav', source: { bytes: audioBase64 } } },
            }, token);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ embedding }));
          } catch (e: any) {
            console.error('[embed-audio]', e.message);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });

      server.middlewares.use('/api/bucket-embeddings', (req: any, res: any) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
        (async () => {
          try {
            if (bucketCache) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ buckets: bucketCache })); return; }
            const token = process.env.VITE_AWS_BEARER_TOKEN_BEDROCK;
            if (!token) throw new Error('No token');
            bucketCache = await Promise.all(BUCKETS.map(async b => ({
              id: b.id,
              embedding: await bedrockEmbed({
                schemaVersion: 'nova-multimodal-embed-v1',
                taskType: 'SINGLE_EMBEDDING',
                singleEmbeddingParams: { embeddingPurpose: 'GENERIC_INDEX', embeddingDimension: 1024, text: { text: b.text } },
              }, token),
            })));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ buckets: bucketCache }));
          } catch (e: any) {
            console.error('[bucket-embeddings]', e.message);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        })();
      });
    }
  };
}

export default defineConfig(({ mode }) => ({
  server: { host: "::", port: 8080, hmr: { overlay: false } },
  plugins: [react(), mode === "development" && componentTagger(), ragApiPlugin()].filter(Boolean),
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  ssr: {
    external: ['fs', 'path'],
    noExternal: [],
  },
}));
