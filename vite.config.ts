import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { randomUUID } from 'node:crypto';
import { BedrockRuntimeClient, InvokeModelWithBidirectionalStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttp2Handler } from '@smithy/node-http-handler';

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

async function novaSonicDirect(audioBase64: string, systemPrompt: string = 'You are a helpful shopping assistant. Keep responses short.'): Promise<{ transcript: string; audioBase64: string }> {
  const client = new BedrockRuntimeClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
    },
    requestHandler: new NodeHttp2Handler({ requestTimeout: 60000, sessionTimeout: 60000 }),
  });

  const promptName = randomUUID();
  const sysId = randomUUID();
  const audioId = randomUUID();

  const events: Buffer[] = [];
  const add = (o: object) => events.push(Buffer.from(JSON.stringify(o)));

  add({ event: { sessionStart: { inferenceConfiguration: { maxTokens: 1024, topP: 0.9, temperature: 0.7 } } } });
  add({ event: { promptStart: { promptName, textOutputConfiguration: { mediaType: 'text/plain' }, audioOutputConfiguration: { mediaType: 'audio/lpcm', sampleRateHertz: 24000, sampleSizeBits: 16, channelCount: 1, voiceId: 'matthew', encoding: 'base64', audioType: 'SPEECH' } } } });
  add({ event: { contentStart: { promptName, contentName: sysId, type: 'TEXT', interactive: false, role: 'SYSTEM', textInputConfiguration: { mediaType: 'text/plain' } } } });
  add({ event: { textInput: { promptName, contentName: sysId, content: systemPrompt } } });
  add({ event: { contentEnd: { promptName, contentName: sysId } } });
  add({ event: { contentStart: { promptName, contentName: audioId, type: 'AUDIO', interactive: true, role: 'USER', audioInputConfiguration: { mediaType: 'audio/lpcm', sampleRateHertz: 16000, sampleSizeBits: 16, channelCount: 1, audioType: 'SPEECH', encoding: 'base64' } } } });

  const pcm = Buffer.from(audioBase64, 'base64');
  for (let i = 0; i < pcm.length; i += 1024) {
    add({ event: { audioInput: { promptName, contentName: audioId, content: pcm.slice(i, i + 1024).toString('base64') } } });
  }

  add({ event: { contentEnd: { promptName, contentName: audioId } } });
  add({ event: { promptEnd: { promptName } } });
  add({ event: { sessionEnd: {} } });

  async function* stream() {
    for (const payload of events) {
      yield { chunk: { bytes: payload } };
      await new Promise(r => setTimeout(r, 10));
    }
  }

  const response = await client.send(
    new InvokeModelWithBidirectionalStreamCommand({ modelId: 'amazon.nova-2-sonic-v1:0', body: stream() })
  );

  const audioChunks: Buffer[] = [];
  let transcript = '';
  let role = '';

  if (!response.body) throw new Error('No response body from Nova Sonic');

  for await (const event of response.body) {
    if (!event.chunk?.bytes) continue;
    let json: any;
    try { json = JSON.parse(new TextDecoder().decode(event.chunk.bytes)); } catch { continue; }
    const ev = json.event;
    if (!ev) continue;
    console.log('[nova-sonic] event keys:', Object.keys(ev), JSON.stringify(ev).slice(0, 200));
    if (ev.contentStart) role = ev.contentStart.role;
    else if (ev.textOutput && role === 'USER') transcript += ev.textOutput.content;
    else if (ev.audioOutput) audioChunks.push(Buffer.from(ev.audioOutput.content, 'base64'));
  }

  console.log('[nova-sonic] done — transcript:', JSON.stringify(transcript), '| audioChunks:', audioChunks.length, '| totalBytes:', audioChunks.reduce((s, c) => s + c.length, 0));
  return { transcript, audioBase64: Buffer.concat(audioChunks).toString('base64') };
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
      for (const [k, v] of Object.entries(env)) { if (!process.env[k]) process.env[k] = v; }

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
            const { audioBase64, systemPrompt } = JSON.parse(body);
            if (!audioBase64) throw new Error('audioBase64 required');
            if (!process.env.AWS_SECRET_ACCESS_KEY) throw new Error('AWS credentials not configured');
            const result = await novaSonicDirect(audioBase64, systemPrompt);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
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

      server.middlewares.use('/api/bunq', async (req: any, res: any) => {
        const BUNQ_BASE = 'https://public-api.sandbox.bunq.com/v1';
        const suffix = req.url ?? '';
        const targetUrl = `${BUNQ_BASE}${suffix}`;
        const token = process.env.VITE_BUNQ_SESSION_TOKEN;
        const headersToForward: Record<string, string> = {
          'Content-Type': 'application/json',
          'Cache-Control': 'none',
          'User-Agent': 'shopper-buddy',
          'X-Bunq-Client-Request-Id': 'r' + Date.now() + Math.random().toString(36).slice(2),
          'X-Bunq-Language': 'en_US',
          'X-Bunq-Region': 'nl_NL',
          'X-Bunq-Geolocation': '0 0 0 0 000',
        };
        if (token) headersToForward['X-Bunq-Client-Authentication'] = token;
        try {
          const body = req.method !== 'GET' && req.method !== 'HEAD' ? await readBody(req) : undefined;
          const upstream = await fetch(targetUrl, {
            method: req.method,
            headers: headersToForward,
            ...(body ? { body } : {}),
          });
          const text = await upstream.text();
          res.statusCode = upstream.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(text);
        } catch (e: any) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: e.message }));
        }
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
