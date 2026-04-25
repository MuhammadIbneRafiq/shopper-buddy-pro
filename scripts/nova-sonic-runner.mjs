/**
 * scripts/nova-sonic-runner.mjs
 * Called by vite.config.ts dev middleware.
 * Reads {audioBase64, systemPrompt} from stdin, writes {transcript, audioBase64} to stdout.
 */
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { BedrockRuntimeClient, InvokeModelWithBidirectionalStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttp2Handler } from '@smithy/node-http-handler';

const env = readFileSync('.env', 'utf8');
const get = (k) => process.env[k] ?? env.match(new RegExp(`${k}="([^"]+)"`))?.[1] ?? null;

const accessKeyId     = get('AWS_ACCESS_KEY_ID');
const secretAccessKey = get('AWS_SECRET_ACCESS_KEY');
const sessionToken    = get('AWS_SESSION_TOKEN');

if (!accessKeyId || !secretAccessKey) {
  process.stderr.write('Missing AWS credentials\n');
  process.exit(1);
}

const input = JSON.parse(await new Promise(r => { let b=''; process.stdin.on('data',c=>b+=c); process.stdin.on('end',()=>r(b)); }));
const { audioBase64, systemPrompt = 'You are a helpful shopping assistant. Keep responses short.' } = input;

const client = new BedrockRuntimeClient({
  region: 'us-east-1',
  credentials: { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) },
  requestHandler: new NodeHttp2Handler({ requestTimeout: 60000, sessionTimeout: 60000 }),
});

const promptName = randomUUID(), sysId = randomUUID(), audioId = randomUUID();
const events = [];
const add = o => events.push(Buffer.from(JSON.stringify(o)));

add({ event: { sessionStart: { inferenceConfiguration: { maxTokens: 1024, topP: 0.9, temperature: 0.7 } } } });
add({ event: { promptStart: { promptName, textOutputConfiguration: { mediaType: 'text/plain' }, audioOutputConfiguration: { mediaType: 'audio/lpcm', sampleRateHertz: 24000, sampleSizeBits: 16, channelCount: 1, voiceId: 'matthew', encoding: 'base64', audioType: 'SPEECH' } } } });
add({ event: { contentStart: { promptName, contentName: sysId, type: 'TEXT', interactive: false, role: 'SYSTEM', textInputConfiguration: { mediaType: 'text/plain' } } } });
add({ event: { textInput: { promptName, contentName: sysId, content: systemPrompt } } });
add({ event: { contentEnd: { promptName, contentName: sysId } } });
add({ event: { contentStart: { promptName, contentName: audioId, type: 'AUDIO', interactive: true, role: 'USER', audioInputConfiguration: { mediaType: 'audio/lpcm', sampleRateHertz: 16000, sampleSizeBits: 16, channelCount: 1, audioType: 'SPEECH', encoding: 'base64' } } } });

const pcm = Buffer.from(audioBase64, 'base64');
for (let i = 0; i < pcm.length; i += 1024)
  add({ event: { audioInput: { promptName, contentName: audioId, content: pcm.slice(i, i + 1024).toString('base64') } } });

add({ event: { contentEnd: { promptName, contentName: audioId } } });
add({ event: { promptEnd: { promptName } } });
add({ event: { sessionEnd: {} } });

async function* stream() {
  for (const p of events) { yield { chunk: { bytes: p } }; await new Promise(r => setTimeout(r, 10)); }
}

const response = await client.send(new InvokeModelWithBidirectionalStreamCommand({ modelId: 'amazon.nova-2-sonic-v1:0', body: stream() }));

const audioChunks = []; let transcript = '', role = '';
for await (const event of response.body) {
  if (!event.chunk?.bytes) continue;
  let json; try { json = JSON.parse(new TextDecoder().decode(event.chunk.bytes)); } catch { continue; }
  const ev = json.event; if (!ev) continue;
  if (ev.contentStart) role = ev.contentStart.role;
  else if (ev.textOutput && role === 'USER') transcript += ev.textOutput.content;
  else if (ev.audioOutput) audioChunks.push(Buffer.from(ev.audioOutput.content, 'base64'));
}

process.stdout.write(JSON.stringify({ transcript, audioBase64: Buffer.concat(audioChunks).toString('base64') }));
