var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// vite.config.ts
import { defineConfig, loadEnv } from "file:///C:/Users/wifi%20stuff/OneDrive%20-%20TU%20Eindhoven/shopper-buddy-pro/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/wifi%20stuff/OneDrive%20-%20TU%20Eindhoven/shopper-buddy-pro/node_modules/@vitejs/plugin-react-swc/index.js";
import path from "path";
import { componentTagger } from "file:///C:/Users/wifi%20stuff/OneDrive%20-%20TU%20Eindhoven/shopper-buddy-pro/node_modules/lovable-tagger/dist/index.js";
import { randomUUID } from "node:crypto";
import { BedrockRuntimeClient, InvokeModelWithBidirectionalStreamCommand } from "file:///C:/Users/wifi%20stuff/OneDrive%20-%20TU%20Eindhoven/shopper-buddy-pro/node_modules/@aws-sdk/client-bedrock-runtime/dist-cjs/index.js";
import { NodeHttp2Handler } from "file:///C:/Users/wifi%20stuff/OneDrive%20-%20TU%20Eindhoven/shopper-buddy-pro/node_modules/@smithy/node-http-handler/dist-cjs/index.js";
var __vite_injected_original_dirname = "C:\\Users\\wifi stuff\\OneDrive - TU Eindhoven\\shopper-buddy-pro";
var BEDROCK_EMBED_URL = "https://bedrock-runtime.us-east-1.amazonaws.com/model/amazon.nova-2-multimodal-embeddings-v1:0/invoke";
var BUCKETS = [
  { id: "CHECKOUT_INITIATE", phrase: "checkout pay now I am done shopping" },
  { id: "SCAN_PRODUCT", phrase: "scan this add this product to my cart" },
  { id: "BALANCE_CHECK", phrase: "what is my balance how much money do I have" },
  { id: "PAYMENT_STATUS", phrase: "is the payment done did it go through" },
  { id: "ALLERGEN_QUERY", phrase: "does this have nuts is this gluten free" },
  { id: "APP_ONBOARDING", phrase: "help how do I use this voice mode button mode" },
  { id: "BASKET_REVIEW", phrase: "show my basket what is in my cart what is my total" },
  { id: "CANCEL_ABORT", phrase: "cancel stop go back never mind abort" }
];
var bucketCache = null;
function readBody(req) {
  return new Promise((r) => {
    let b = "";
    req.on("data", (c) => b += c);
    req.on("end", () => r(b));
  });
}
async function novaSonicDirect(audioBase64, systemPrompt = "You are a helpful shopping assistant. Keep responses short.") {
  const client = new BedrockRuntimeClient({
    region: "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      ...process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}
    },
    requestHandler: new NodeHttp2Handler({ requestTimeout: 6e4, sessionTimeout: 6e4 })
  });
  const promptName = randomUUID();
  const sysId = randomUUID();
  const audioId = randomUUID();
  const events = [];
  const add = (o) => events.push(Buffer.from(JSON.stringify(o)));
  add({ event: { sessionStart: { inferenceConfiguration: { maxTokens: 1024, topP: 0.9, temperature: 0.7 } } } });
  add({ event: { promptStart: { promptName, textOutputConfiguration: { mediaType: "text/plain" }, audioOutputConfiguration: { mediaType: "audio/lpcm", sampleRateHertz: 24e3, sampleSizeBits: 16, channelCount: 1, voiceId: "matthew", encoding: "base64", audioType: "SPEECH" } } } });
  add({ event: { contentStart: { promptName, contentName: sysId, type: "TEXT", interactive: false, role: "SYSTEM", textInputConfiguration: { mediaType: "text/plain" } } } });
  add({ event: { textInput: { promptName, contentName: sysId, content: systemPrompt } } });
  add({ event: { contentEnd: { promptName, contentName: sysId } } });
  add({ event: { contentStart: { promptName, contentName: audioId, type: "AUDIO", interactive: true, role: "USER", audioInputConfiguration: { mediaType: "audio/lpcm", sampleRateHertz: 16e3, sampleSizeBits: 16, channelCount: 1, audioType: "SPEECH", encoding: "base64" } } } });
  const pcm = Buffer.from(audioBase64, "base64");
  for (let i = 0; i < pcm.length; i += 1024) {
    add({ event: { audioInput: { promptName, contentName: audioId, content: pcm.slice(i, i + 1024).toString("base64") } } });
  }
  add({ event: { contentEnd: { promptName, contentName: audioId } } });
  add({ event: { promptEnd: { promptName } } });
  add({ event: { sessionEnd: {} } });
  async function* stream() {
    for (const payload of events) {
      yield { chunk: { bytes: payload } };
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  const response = await client.send(
    new InvokeModelWithBidirectionalStreamCommand({ modelId: "amazon.nova-2-sonic-v1:0", body: stream() })
  );
  const audioChunks = [];
  let transcript = "";
  let role = "";
  if (!response.body) throw new Error("No response body from Nova Sonic");
  for await (const event of response.body) {
    if (!event.chunk?.bytes) continue;
    let json;
    try {
      json = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
    } catch {
      continue;
    }
    const ev = json.event;
    if (!ev) continue;
    if (ev.contentStart) role = ev.contentStart.role;
    else if (ev.textOutput && role === "USER") transcript += ev.textOutput.content;
    else if (ev.audioOutput) audioChunks.push(Buffer.from(ev.audioOutput.content, "base64"));
  }
  return { transcript, audioBase64: Buffer.concat(audioChunks).toString("base64") };
}
function synthesizeWav(phrase) {
  return new Promise((resolve, reject) => {
    const { spawn } = __require("child_process");
    const chunks = [];
    const ff = spawn("ffmpeg", ["-f", "lavfi", "-i", `flite=text='${phrase.replace(/'/g, "")}':voice=rms`, "-ar", "16000", "-ac", "1", "-f", "wav", "pipe:1"], { stdio: ["ignore", "pipe", "pipe"] });
    ff.stdout.on("data", (c) => chunks.push(c));
    ff.stderr.on("data", () => {
    });
    ff.on("close", (code) => {
      if (code !== 0 && chunks.length === 0) return reject(new Error(`ffmpeg exit ${code}`));
      resolve(Buffer.concat(chunks));
    });
    ff.on("error", reject);
  });
}
async function embedAudio(wavBase64, token) {
  const res = await fetch(BEDROCK_EMBED_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ schemaVersion: "nova-multimodal-embed-v1", taskType: "SINGLE_EMBEDDING", singleEmbeddingParams: { embeddingPurpose: "GENERIC_INDEX", embeddingDimension: 1024, audio: { format: "wav", source: { bytes: wavBase64 } } } })
  });
  if (!res.ok) throw new Error(`Bedrock ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.embeddings?.[0]?.embedding ?? [];
}
function ragApiPlugin() {
  return {
    name: "rag-api",
    configureServer(server) {
      const env = loadEnv("development", process.cwd(), "");
      Object.assign(process.env, env);
      server.middlewares.use("/api/rag", (req, res) => {
        if (req.method !== "POST") return;
        readBody(req).then(async (body) => {
          try {
            const { processProductImage } = await server.ssrLoadModule("/src/lib/productRag.ts");
            const { imageBase64 } = JSON.parse(body);
            const result = await processProductImage(imageBase64);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
      server.middlewares.use("/api/nova-sonic", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        readBody(req).then(async (body) => {
          try {
            const { audioBase64, systemPrompt } = JSON.parse(body);
            if (!audioBase64) throw new Error("audioBase64 required");
            if (!process.env.AWS_SECRET_ACCESS_KEY) throw new Error("AWS credentials not configured");
            const result = await novaSonicDirect(audioBase64, systemPrompt);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
          } catch (e) {
            console.error("[nova-sonic]", e.message);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
      server.middlewares.use("/api/embed-audio", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        readBody(req).then(async (body) => {
          try {
            const { audioBase64 } = JSON.parse(body);
            const token = process.env.VITE_AWS_BEARER_TOKEN_BEDROCK;
            if (!token) throw new Error("No token");
            const embedding = await embedAudio(audioBase64, token);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ embedding }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
      server.middlewares.use("/api/bucket-embeddings", (req, res) => {
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.end();
          return;
        }
        (async () => {
          try {
            if (bucketCache) {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ buckets: bucketCache }));
              return;
            }
            const token = process.env.VITE_AWS_BEARER_TOKEN_BEDROCK;
            if (!token) throw new Error("No token");
            bucketCache = await Promise.all(BUCKETS.map(async (b) => ({ id: b.id, embedding: await embedAudio((await synthesizeWav(b.phrase)).toString("base64"), token) })));
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ buckets: bucketCache }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        })();
      });
    }
  };
}
var vite_config_default = defineConfig(({ mode }) => ({
  server: { host: "::", port: 8080, hmr: { overlay: false } },
  plugins: [react(), mode === "development" && componentTagger(), ragApiPlugin()].filter(Boolean),
  resolve: {
    alias: { "@": path.resolve(__vite_injected_original_dirname, "./src") },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"]
  },
  ssr: { external: ["fs", "path"], noExternal: [] }
}));
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFx3aWZpIHN0dWZmXFxcXE9uZURyaXZlIC0gVFUgRWluZGhvdmVuXFxcXHNob3BwZXItYnVkZHktcHJvXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFx3aWZpIHN0dWZmXFxcXE9uZURyaXZlIC0gVFUgRWluZGhvdmVuXFxcXHNob3BwZXItYnVkZHktcHJvXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9DOi9Vc2Vycy93aWZpJTIwc3R1ZmYvT25lRHJpdmUlMjAtJTIwVFUlMjBFaW5kaG92ZW4vc2hvcHBlci1idWRkeS1wcm8vdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcsIGxvYWRFbnYgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdC1zd2NcIjtcbmltcG9ydCBwYXRoIGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBjb21wb25lbnRUYWdnZXIgfSBmcm9tIFwibG92YWJsZS10YWdnZXJcIjtcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdub2RlOmNyeXB0byc7XG5pbXBvcnQgeyBCZWRyb2NrUnVudGltZUNsaWVudCwgSW52b2tlTW9kZWxXaXRoQmlkaXJlY3Rpb25hbFN0cmVhbUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtYmVkcm9jay1ydW50aW1lJztcbmltcG9ydCB7IE5vZGVIdHRwMkhhbmRsZXIgfSBmcm9tICdAc21pdGh5L25vZGUtaHR0cC1oYW5kbGVyJztcblxuY29uc3QgQkVEUk9DS19FTUJFRF9VUkwgPSAnaHR0cHM6Ly9iZWRyb2NrLXJ1bnRpbWUudXMtZWFzdC0xLmFtYXpvbmF3cy5jb20vbW9kZWwvYW1hem9uLm5vdmEtMi1tdWx0aW1vZGFsLWVtYmVkZGluZ3MtdjE6MC9pbnZva2UnO1xuXG5jb25zdCBCVUNLRVRTID0gW1xuICB7IGlkOiAnQ0hFQ0tPVVRfSU5JVElBVEUnLCBwaHJhc2U6ICdjaGVja291dCBwYXkgbm93IEkgYW0gZG9uZSBzaG9wcGluZycgfSxcbiAgeyBpZDogJ1NDQU5fUFJPRFVDVCcsICAgICAgcGhyYXNlOiAnc2NhbiB0aGlzIGFkZCB0aGlzIHByb2R1Y3QgdG8gbXkgY2FydCcgfSxcbiAgeyBpZDogJ0JBTEFOQ0VfQ0hFQ0snLCAgICAgcGhyYXNlOiAnd2hhdCBpcyBteSBiYWxhbmNlIGhvdyBtdWNoIG1vbmV5IGRvIEkgaGF2ZScgfSxcbiAgeyBpZDogJ1BBWU1FTlRfU1RBVFVTJywgICAgcGhyYXNlOiAnaXMgdGhlIHBheW1lbnQgZG9uZSBkaWQgaXQgZ28gdGhyb3VnaCcgfSxcbiAgeyBpZDogJ0FMTEVSR0VOX1FVRVJZJywgICAgcGhyYXNlOiAnZG9lcyB0aGlzIGhhdmUgbnV0cyBpcyB0aGlzIGdsdXRlbiBmcmVlJyB9LFxuICB7IGlkOiAnQVBQX09OQk9BUkRJTkcnLCAgICBwaHJhc2U6ICdoZWxwIGhvdyBkbyBJIHVzZSB0aGlzIHZvaWNlIG1vZGUgYnV0dG9uIG1vZGUnIH0sXG4gIHsgaWQ6ICdCQVNLRVRfUkVWSUVXJywgICAgIHBocmFzZTogJ3Nob3cgbXkgYmFza2V0IHdoYXQgaXMgaW4gbXkgY2FydCB3aGF0IGlzIG15IHRvdGFsJyB9LFxuICB7IGlkOiAnQ0FOQ0VMX0FCT1JUJywgICAgICBwaHJhc2U6ICdjYW5jZWwgc3RvcCBnbyBiYWNrIG5ldmVyIG1pbmQgYWJvcnQnIH0sXG5dO1xuXG5sZXQgYnVja2V0Q2FjaGU6IHsgaWQ6IHN0cmluZzsgZW1iZWRkaW5nOiBudW1iZXJbXSB9W10gfCBudWxsID0gbnVsbDtcblxuZnVuY3Rpb24gcmVhZEJvZHkocmVxOiBhbnkpOiBQcm9taXNlPHN0cmluZz4ge1xuICByZXR1cm4gbmV3IFByb21pc2UociA9PiB7IGxldCBiID0gJyc7IHJlcS5vbignZGF0YScsIChjOiBhbnkpID0+IGIgKz0gYyk7IHJlcS5vbignZW5kJywgKCkgPT4gcihiKSk7IH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBub3ZhU29uaWNEaXJlY3QoYXVkaW9CYXNlNjQ6IHN0cmluZywgc3lzdGVtUHJvbXB0OiBzdHJpbmcgPSAnWW91IGFyZSBhIGhlbHBmdWwgc2hvcHBpbmcgYXNzaXN0YW50LiBLZWVwIHJlc3BvbnNlcyBzaG9ydC4nKTogUHJvbWlzZTx7IHRyYW5zY3JpcHQ6IHN0cmluZzsgYXVkaW9CYXNlNjQ6IHN0cmluZyB9PiB7XG4gIGNvbnN0IGNsaWVudCA9IG5ldyBCZWRyb2NrUnVudGltZUNsaWVudCh7XG4gICAgcmVnaW9uOiAndXMtZWFzdC0xJyxcbiAgICBjcmVkZW50aWFsczoge1xuICAgICAgYWNjZXNzS2V5SWQ6IHByb2Nlc3MuZW52LkFXU19BQ0NFU1NfS0VZX0lEISxcbiAgICAgIHNlY3JldEFjY2Vzc0tleTogcHJvY2Vzcy5lbnYuQVdTX1NFQ1JFVF9BQ0NFU1NfS0VZISxcbiAgICAgIC4uLihwcm9jZXNzLmVudi5BV1NfU0VTU0lPTl9UT0tFTiA/IHsgc2Vzc2lvblRva2VuOiBwcm9jZXNzLmVudi5BV1NfU0VTU0lPTl9UT0tFTiB9IDoge30pLFxuICAgIH0sXG4gICAgcmVxdWVzdEhhbmRsZXI6IG5ldyBOb2RlSHR0cDJIYW5kbGVyKHsgcmVxdWVzdFRpbWVvdXQ6IDYwMDAwLCBzZXNzaW9uVGltZW91dDogNjAwMDAgfSksXG4gIH0pO1xuXG4gIGNvbnN0IHByb21wdE5hbWUgPSByYW5kb21VVUlEKCk7XG4gIGNvbnN0IHN5c0lkID0gcmFuZG9tVVVJRCgpO1xuICBjb25zdCBhdWRpb0lkID0gcmFuZG9tVVVJRCgpO1xuXG4gIGNvbnN0IGV2ZW50czogQnVmZmVyW10gPSBbXTtcbiAgY29uc3QgYWRkID0gKG86IG9iamVjdCkgPT4gZXZlbnRzLnB1c2goQnVmZmVyLmZyb20oSlNPTi5zdHJpbmdpZnkobykpKTtcblxuICBhZGQoeyBldmVudDogeyBzZXNzaW9uU3RhcnQ6IHsgaW5mZXJlbmNlQ29uZmlndXJhdGlvbjogeyBtYXhUb2tlbnM6IDEwMjQsIHRvcFA6IDAuOSwgdGVtcGVyYXR1cmU6IDAuNyB9IH0gfSB9KTtcbiAgYWRkKHsgZXZlbnQ6IHsgcHJvbXB0U3RhcnQ6IHsgcHJvbXB0TmFtZSwgdGV4dE91dHB1dENvbmZpZ3VyYXRpb246IHsgbWVkaWFUeXBlOiAndGV4dC9wbGFpbicgfSwgYXVkaW9PdXRwdXRDb25maWd1cmF0aW9uOiB7IG1lZGlhVHlwZTogJ2F1ZGlvL2xwY20nLCBzYW1wbGVSYXRlSGVydHo6IDI0MDAwLCBzYW1wbGVTaXplQml0czogMTYsIGNoYW5uZWxDb3VudDogMSwgdm9pY2VJZDogJ21hdHRoZXcnLCBlbmNvZGluZzogJ2Jhc2U2NCcsIGF1ZGlvVHlwZTogJ1NQRUVDSCcgfSB9IH0gfSk7XG4gIGFkZCh7IGV2ZW50OiB7IGNvbnRlbnRTdGFydDogeyBwcm9tcHROYW1lLCBjb250ZW50TmFtZTogc3lzSWQsIHR5cGU6ICdURVhUJywgaW50ZXJhY3RpdmU6IGZhbHNlLCByb2xlOiAnU1lTVEVNJywgdGV4dElucHV0Q29uZmlndXJhdGlvbjogeyBtZWRpYVR5cGU6ICd0ZXh0L3BsYWluJyB9IH0gfSB9KTtcbiAgYWRkKHsgZXZlbnQ6IHsgdGV4dElucHV0OiB7IHByb21wdE5hbWUsIGNvbnRlbnROYW1lOiBzeXNJZCwgY29udGVudDogc3lzdGVtUHJvbXB0IH0gfSB9KTtcbiAgYWRkKHsgZXZlbnQ6IHsgY29udGVudEVuZDogeyBwcm9tcHROYW1lLCBjb250ZW50TmFtZTogc3lzSWQgfSB9IH0pO1xuICBhZGQoeyBldmVudDogeyBjb250ZW50U3RhcnQ6IHsgcHJvbXB0TmFtZSwgY29udGVudE5hbWU6IGF1ZGlvSWQsIHR5cGU6ICdBVURJTycsIGludGVyYWN0aXZlOiB0cnVlLCByb2xlOiAnVVNFUicsIGF1ZGlvSW5wdXRDb25maWd1cmF0aW9uOiB7IG1lZGlhVHlwZTogJ2F1ZGlvL2xwY20nLCBzYW1wbGVSYXRlSGVydHo6IDE2MDAwLCBzYW1wbGVTaXplQml0czogMTYsIGNoYW5uZWxDb3VudDogMSwgYXVkaW9UeXBlOiAnU1BFRUNIJywgZW5jb2Rpbmc6ICdiYXNlNjQnIH0gfSB9IH0pO1xuXG4gIGNvbnN0IHBjbSA9IEJ1ZmZlci5mcm9tKGF1ZGlvQmFzZTY0LCAnYmFzZTY0Jyk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGNtLmxlbmd0aDsgaSArPSAxMDI0KSB7XG4gICAgYWRkKHsgZXZlbnQ6IHsgYXVkaW9JbnB1dDogeyBwcm9tcHROYW1lLCBjb250ZW50TmFtZTogYXVkaW9JZCwgY29udGVudDogcGNtLnNsaWNlKGksIGkgKyAxMDI0KS50b1N0cmluZygnYmFzZTY0JykgfSB9IH0pO1xuICB9XG5cbiAgYWRkKHsgZXZlbnQ6IHsgY29udGVudEVuZDogeyBwcm9tcHROYW1lLCBjb250ZW50TmFtZTogYXVkaW9JZCB9IH0gfSk7XG4gIGFkZCh7IGV2ZW50OiB7IHByb21wdEVuZDogeyBwcm9tcHROYW1lIH0gfSB9KTtcbiAgYWRkKHsgZXZlbnQ6IHsgc2Vzc2lvbkVuZDoge30gfSB9KTtcblxuICBhc3luYyBmdW5jdGlvbiogc3RyZWFtKCkge1xuICAgIGZvciAoY29uc3QgcGF5bG9hZCBvZiBldmVudHMpIHtcbiAgICAgIHlpZWxkIHsgY2h1bms6IHsgYnl0ZXM6IHBheWxvYWQgfSB9O1xuICAgICAgYXdhaXQgbmV3IFByb21pc2UociA9PiBzZXRUaW1lb3V0KHIsIDEwKSk7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjbGllbnQuc2VuZChcbiAgICBuZXcgSW52b2tlTW9kZWxXaXRoQmlkaXJlY3Rpb25hbFN0cmVhbUNvbW1hbmQoeyBtb2RlbElkOiAnYW1hem9uLm5vdmEtMi1zb25pYy12MTowJywgYm9keTogc3RyZWFtKCkgfSlcbiAgKTtcblxuICBjb25zdCBhdWRpb0NodW5rczogQnVmZmVyW10gPSBbXTtcbiAgbGV0IHRyYW5zY3JpcHQgPSAnJztcbiAgbGV0IHJvbGUgPSAnJztcblxuICBpZiAoIXJlc3BvbnNlLmJvZHkpIHRocm93IG5ldyBFcnJvcignTm8gcmVzcG9uc2UgYm9keSBmcm9tIE5vdmEgU29uaWMnKTtcblxuICBmb3IgYXdhaXQgKGNvbnN0IGV2ZW50IG9mIHJlc3BvbnNlLmJvZHkpIHtcbiAgICBpZiAoIWV2ZW50LmNodW5rPy5ieXRlcykgY29udGludWU7XG4gICAgbGV0IGpzb246IGFueTtcbiAgICB0cnkgeyBqc29uID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoZXZlbnQuY2h1bmsuYnl0ZXMpKTsgfSBjYXRjaCB7IGNvbnRpbnVlOyB9XG4gICAgY29uc3QgZXYgPSBqc29uLmV2ZW50O1xuICAgIGlmICghZXYpIGNvbnRpbnVlO1xuICAgIGlmIChldi5jb250ZW50U3RhcnQpIHJvbGUgPSBldi5jb250ZW50U3RhcnQucm9sZTtcbiAgICBlbHNlIGlmIChldi50ZXh0T3V0cHV0ICYmIHJvbGUgPT09ICdVU0VSJykgdHJhbnNjcmlwdCArPSBldi50ZXh0T3V0cHV0LmNvbnRlbnQ7XG4gICAgZWxzZSBpZiAoZXYuYXVkaW9PdXRwdXQpIGF1ZGlvQ2h1bmtzLnB1c2goQnVmZmVyLmZyb20oZXYuYXVkaW9PdXRwdXQuY29udGVudCwgJ2Jhc2U2NCcpKTtcbiAgfVxuXG4gIHJldHVybiB7IHRyYW5zY3JpcHQsIGF1ZGlvQmFzZTY0OiBCdWZmZXIuY29uY2F0KGF1ZGlvQ2h1bmtzKS50b1N0cmluZygnYmFzZTY0JykgfTtcbn1cblxuZnVuY3Rpb24gc3ludGhlc2l6ZVdhdihwaHJhc2U6IHN0cmluZyk6IFByb21pc2U8QnVmZmVyPiB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3QgeyBzcGF3biB9ID0gcmVxdWlyZSgnY2hpbGRfcHJvY2VzcycpO1xuICAgIGNvbnN0IGNodW5rczogQnVmZmVyW10gPSBbXTtcbiAgICBjb25zdCBmZiA9IHNwYXduKCdmZm1wZWcnLCBbJy1mJywgJ2xhdmZpJywgJy1pJywgYGZsaXRlPXRleHQ9JyR7cGhyYXNlLnJlcGxhY2UoLycvZywgJycpfSc6dm9pY2U9cm1zYCwgJy1hcicsICcxNjAwMCcsICctYWMnLCAnMScsICctZicsICd3YXYnLCAncGlwZToxJ10sIHsgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddIH0pO1xuICAgIGZmLnN0ZG91dC5vbignZGF0YScsIChjOiBCdWZmZXIpID0+IGNodW5rcy5wdXNoKGMpKTtcbiAgICBmZi5zdGRlcnIub24oJ2RhdGEnLCAoKSA9PiB7fSk7XG4gICAgZmYub24oJ2Nsb3NlJywgKGNvZGU6IG51bWJlcikgPT4geyBpZiAoY29kZSAhPT0gMCAmJiBjaHVua3MubGVuZ3RoID09PSAwKSByZXR1cm4gcmVqZWN0KG5ldyBFcnJvcihgZmZtcGVnIGV4aXQgJHtjb2RlfWApKTsgcmVzb2x2ZShCdWZmZXIuY29uY2F0KGNodW5rcykpOyB9KTtcbiAgICBmZi5vbignZXJyb3InLCByZWplY3QpO1xuICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZW1iZWRBdWRpbyh3YXZCYXNlNjQ6IHN0cmluZywgdG9rZW46IHN0cmluZyk6IFByb21pc2U8bnVtYmVyW10+IHtcbiAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goQkVEUk9DS19FTUJFRF9VUkwsIHtcbiAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICBoZWFkZXJzOiB7IEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHt0b2tlbn1gLCAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLCBBY2NlcHQ6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgc2NoZW1hVmVyc2lvbjogJ25vdmEtbXVsdGltb2RhbC1lbWJlZC12MScsIHRhc2tUeXBlOiAnU0lOR0xFX0VNQkVERElORycsIHNpbmdsZUVtYmVkZGluZ1BhcmFtczogeyBlbWJlZGRpbmdQdXJwb3NlOiAnR0VORVJJQ19JTkRFWCcsIGVtYmVkZGluZ0RpbWVuc2lvbjogMTAyNCwgYXVkaW86IHsgZm9ybWF0OiAnd2F2Jywgc291cmNlOiB7IGJ5dGVzOiB3YXZCYXNlNjQgfSB9IH0gfSksXG4gIH0pO1xuICBpZiAoIXJlcy5vaykgdGhyb3cgbmV3IEVycm9yKGBCZWRyb2NrICR7cmVzLnN0YXR1c306ICR7YXdhaXQgcmVzLnRleHQoKX1gKTtcbiAgY29uc3QgZCA9IGF3YWl0IHJlcy5qc29uKCkgYXMgYW55O1xuICByZXR1cm4gZC5lbWJlZGRpbmdzPy5bMF0/LmVtYmVkZGluZyA/PyBbXTtcbn1cblxuZnVuY3Rpb24gcmFnQXBpUGx1Z2luKCkge1xuICByZXR1cm4ge1xuICAgIG5hbWU6ICdyYWctYXBpJyxcbiAgICBjb25maWd1cmVTZXJ2ZXIoc2VydmVyOiBhbnkpIHtcbiAgICAgIGNvbnN0IGVudiA9IGxvYWRFbnYoJ2RldmVsb3BtZW50JywgcHJvY2Vzcy5jd2QoKSwgJycpO1xuICAgICAgT2JqZWN0LmFzc2lnbihwcm9jZXNzLmVudiwgZW52KTtcblxuICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZSgnL2FwaS9yYWcnLCAocmVxOiBhbnksIHJlczogYW55KSA9PiB7XG4gICAgICAgIGlmIChyZXEubWV0aG9kICE9PSAnUE9TVCcpIHJldHVybjtcbiAgICAgICAgcmVhZEJvZHkocmVxKS50aGVuKGFzeW5jIGJvZHkgPT4ge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCB7IHByb2Nlc3NQcm9kdWN0SW1hZ2UgfSA9IGF3YWl0IHNlcnZlci5zc3JMb2FkTW9kdWxlKCcvc3JjL2xpYi9wcm9kdWN0UmFnLnRzJyk7XG4gICAgICAgICAgICBjb25zdCB7IGltYWdlQmFzZTY0IH0gPSBKU09OLnBhcnNlKGJvZHkpO1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcHJvY2Vzc1Byb2R1Y3RJbWFnZShpbWFnZUJhc2U2NCk7XG4gICAgICAgICAgICByZXMuc2V0SGVhZGVyKCdDb250ZW50LVR5cGUnLCAnYXBwbGljYXRpb24vanNvbicpO1xuICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeShyZXN1bHQpKTtcbiAgICAgICAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgICAgICAgIHJlcy5zdGF0dXNDb2RlID0gNTAwO1xuICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogU3RyaW5nKGUpIH0pKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIE5vdmEgU29uaWM6IHNwZWVjaC10by1zcGVlY2ggdmlhIGJpZGlyZWN0aW9uYWwgc3RyZWFtXG4gICAgICBzZXJ2ZXIubWlkZGxld2FyZXMudXNlKCcvYXBpL25vdmEtc29uaWMnLCAocmVxOiBhbnksIHJlczogYW55KSA9PiB7XG4gICAgICAgIGlmIChyZXEubWV0aG9kICE9PSAnUE9TVCcpIHsgcmVzLnN0YXR1c0NvZGUgPSA0MDU7IHJlcy5lbmQoKTsgcmV0dXJuOyB9XG4gICAgICAgIHJlYWRCb2R5KHJlcSkudGhlbihhc3luYyBib2R5ID0+IHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgeyBhdWRpb0Jhc2U2NCwgc3lzdGVtUHJvbXB0IH0gPSBKU09OLnBhcnNlKGJvZHkpO1xuICAgICAgICAgICAgaWYgKCFhdWRpb0Jhc2U2NCkgdGhyb3cgbmV3IEVycm9yKCdhdWRpb0Jhc2U2NCByZXF1aXJlZCcpO1xuICAgICAgICAgICAgaWYgKCFwcm9jZXNzLmVudi5BV1NfU0VDUkVUX0FDQ0VTU19LRVkpIHRocm93IG5ldyBFcnJvcignQVdTIGNyZWRlbnRpYWxzIG5vdCBjb25maWd1cmVkJyk7XG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBub3ZhU29uaWNEaXJlY3QoYXVkaW9CYXNlNjQsIHN5c3RlbVByb21wdCk7XG4gICAgICAgICAgICByZXMuc2V0SGVhZGVyKCdDb250ZW50LVR5cGUnLCAnYXBwbGljYXRpb24vanNvbicpO1xuICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeShyZXN1bHQpKTtcbiAgICAgICAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tub3ZhLXNvbmljXScsIGUubWVzc2FnZSk7XG4gICAgICAgICAgICByZXMuc3RhdHVzQ29kZSA9IDUwMDtcbiAgICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogZS5tZXNzYWdlIH0pKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIHNlcnZlci5taWRkbGV3YXJlcy51c2UoJy9hcGkvZW1iZWQtYXVkaW8nLCAocmVxOiBhbnksIHJlczogYW55KSA9PiB7XG4gICAgICAgIGlmIChyZXEubWV0aG9kICE9PSAnUE9TVCcpIHsgcmVzLnN0YXR1c0NvZGUgPSA0MDU7IHJlcy5lbmQoKTsgcmV0dXJuOyB9XG4gICAgICAgIHJlYWRCb2R5KHJlcSkudGhlbihhc3luYyBib2R5ID0+IHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgeyBhdWRpb0Jhc2U2NCB9ID0gSlNPTi5wYXJzZShib2R5KTtcbiAgICAgICAgICAgIGNvbnN0IHRva2VuID0gcHJvY2Vzcy5lbnYuVklURV9BV1NfQkVBUkVSX1RPS0VOX0JFRFJPQ0s7XG4gICAgICAgICAgICBpZiAoIXRva2VuKSB0aHJvdyBuZXcgRXJyb3IoJ05vIHRva2VuJyk7XG4gICAgICAgICAgICBjb25zdCBlbWJlZGRpbmcgPSBhd2FpdCBlbWJlZEF1ZGlvKGF1ZGlvQmFzZTY0LCB0b2tlbik7XG4gICAgICAgICAgICByZXMuc2V0SGVhZGVyKCdDb250ZW50LVR5cGUnLCAnYXBwbGljYXRpb24vanNvbicpO1xuICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IGVtYmVkZGluZyB9KSk7XG4gICAgICAgICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICAgICAgICByZXMuc3RhdHVzQ29kZSA9IDUwMDtcbiAgICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogZS5tZXNzYWdlIH0pKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIHNlcnZlci5taWRkbGV3YXJlcy51c2UoJy9hcGkvYnVja2V0LWVtYmVkZGluZ3MnLCAocmVxOiBhbnksIHJlczogYW55KSA9PiB7XG4gICAgICAgIGlmIChyZXEubWV0aG9kICE9PSAnR0VUJykgeyByZXMuc3RhdHVzQ29kZSA9IDQwNTsgcmVzLmVuZCgpOyByZXR1cm47IH1cbiAgICAgICAgKGFzeW5jICgpID0+IHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgaWYgKGJ1Y2tldENhY2hlKSB7IHJlcy5zZXRIZWFkZXIoJ0NvbnRlbnQtVHlwZScsICdhcHBsaWNhdGlvbi9qc29uJyk7IHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBidWNrZXRzOiBidWNrZXRDYWNoZSB9KSk7IHJldHVybjsgfVxuICAgICAgICAgICAgY29uc3QgdG9rZW4gPSBwcm9jZXNzLmVudi5WSVRFX0FXU19CRUFSRVJfVE9LRU5fQkVEUk9DSztcbiAgICAgICAgICAgIGlmICghdG9rZW4pIHRocm93IG5ldyBFcnJvcignTm8gdG9rZW4nKTtcbiAgICAgICAgICAgIGJ1Y2tldENhY2hlID0gYXdhaXQgUHJvbWlzZS5hbGwoQlVDS0VUUy5tYXAoYXN5bmMgYiA9PiAoeyBpZDogYi5pZCwgZW1iZWRkaW5nOiBhd2FpdCBlbWJlZEF1ZGlvKChhd2FpdCBzeW50aGVzaXplV2F2KGIucGhyYXNlKSkudG9TdHJpbmcoJ2Jhc2U2NCcpLCB0b2tlbikgfSkpKTtcbiAgICAgICAgICAgIHJlcy5zZXRIZWFkZXIoJ0NvbnRlbnQtVHlwZScsICdhcHBsaWNhdGlvbi9qc29uJyk7XG4gICAgICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHsgYnVja2V0czogYnVja2V0Q2FjaGUgfSkpO1xuICAgICAgICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgICAgICAgcmVzLnN0YXR1c0NvZGUgPSA1MDA7XG4gICAgICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IGUubWVzc2FnZSB9KSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KSgpO1xuICAgICAgfSk7XG4gICAgfVxuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoKHsgbW9kZSB9KSA9PiAoe1xuICBzZXJ2ZXI6IHsgaG9zdDogXCI6OlwiLCBwb3J0OiA4MDgwLCBobXI6IHsgb3ZlcmxheTogZmFsc2UgfSB9LFxuICBwbHVnaW5zOiBbcmVhY3QoKSwgbW9kZSA9PT0gXCJkZXZlbG9wbWVudFwiICYmIGNvbXBvbmVudFRhZ2dlcigpLCByYWdBcGlQbHVnaW4oKV0uZmlsdGVyKEJvb2xlYW4pLFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHsgXCJAXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmNcIikgfSxcbiAgICBkZWR1cGU6IFtcInJlYWN0XCIsIFwicmVhY3QtZG9tXCIsIFwicmVhY3QvanN4LXJ1bnRpbWVcIiwgXCJyZWFjdC9qc3gtZGV2LXJ1bnRpbWVcIiwgXCJAdGFuc3RhY2svcmVhY3QtcXVlcnlcIiwgXCJAdGFuc3RhY2svcXVlcnktY29yZVwiXSxcbiAgfSxcbiAgc3NyOiB7IGV4dGVybmFsOiBbJ2ZzJywgJ3BhdGgnXSwgbm9FeHRlcm5hbDogW10gfSxcbn0pKTtcbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7O0FBQTJYLFNBQVMsY0FBYyxlQUFlO0FBQ2phLE9BQU8sV0FBVztBQUNsQixPQUFPLFVBQVU7QUFDakIsU0FBUyx1QkFBdUI7QUFDaEMsU0FBUyxrQkFBa0I7QUFDM0IsU0FBUyxzQkFBc0IsaURBQWlEO0FBQ2hGLFNB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
