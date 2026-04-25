import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const BEDROCK_EMBED_URL = 'https://bedrock-runtime.us-east-1.amazonaws.com/model/amazon.nova-2-multimodal-embeddings-v1:0/invoke';

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

let bucketCache: { id: string; embedding: number[] }[] | null = null;

function readBody(req: any): Promise<string> {
  return new Promise(r => { let b = ''; req.on('data', (c: any) => b += c); req.on('end', () => r(b)); });
}

function spawnRunner(input: object): Promise<string> {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const chunks: Buffer[] = [];
    const child = spawn('node', ['scripts/nova-sonic-runner.mjs'], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (d: Buffer) => process.stderr.write('[nova-sonic] ' + d));
    child.on('close', (code: number) => {
      if (code !== 0 && chunks.length === 0) return reject(new Error('nova-sonic runner failed'));
      resolve(Buffer.concat(chunks).toString());
    });
  });
}

function synthesizeWav(phrase: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const chunks: Buffer[] = [];
    const ff = spawn('ffmpeg', ['-f', 'lavfi', '-i', `flite=text='${phrase.replace(/'/g, '')}':voice=rms`, '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    ff.stdout.on('data', (c: Buffer) => chunks.push(c));
    ff.stderr.on('data', () => {});
    ff.on('close', (code: number) => { if (code !== 0 && chunks.length === 0) return reject(new Error(`ffmpeg exit ${code}`)); resolve(Buffer.concat(chunks)); });
    ff.on('error', reject);
  });
}

async function embedAudio(wavBase64: string, token: string): Promise<number[]> {
  const res = await fetch(BEDROCK_EMBED_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ schemaVersion: 'nova-multimodal-embed-v1', taskType: 'SINGLE_EMBEDDING', singleEmbeddingParams: { embeddingPurpose: 'GENERIC_INDEX', embeddingDimension: 1024, audio: { format: 'wav', source: { bytes: wavBase64 } } } }),
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
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });

      // Nova Sonic: speech-to-speech via bidirectional stream
      server.middlewares.use('/api/nova-sonic', (req: any, res: any) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        readBody(req).then(async body => {
          try {
            const result = await spawnRunner(JSON.parse(body));
            res.setHeader('Content-Type', 'application/json');
            res.end(result);
          } catch (e: any) {
            console.error('[nova-sonic]', e.message);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
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
            const embedding = await embedAudio(audioBase64, token);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ embedding }));
          } catch (e: any) {
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
            bucketCache = await Promise.all(BUCKETS.map(async b => ({ id: b.id, embedding: await embedAudio((await synthesizeWav(b.phrase)).toString('base64'), token) })));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ buckets: bucketCache }));
          } catch (e: any) {
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
  ssr: { external: ['fs', 'path'], noExternal: [] },
}));
