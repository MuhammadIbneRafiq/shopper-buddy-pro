/**
 * test-nova-sonic-s2s.mjs
 *
 * Tests Amazon Nova Sonic (amazon.nova-2-sonic-v1:0) speech-to-speech.
 *
 * Requires real AWS credentials (NOT the Bearer token — Nova Sonic rejects it).
 * Add to .env:
 *   AWS_ACCESS_KEY_ID="..."
 *   AWS_SECRET_ACCESS_KEY="..."
 *   AWS_SESSION_TOKEN="..."   (if using temporary creds)
 *
 * Or set them as environment variables before running.
 *
 * Run: node test-nova-sonic-s2s.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { BedrockRuntimeClient, InvokeModelWithBidirectionalStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttp2Handler } from '@smithy/node-http-handler';

// ─── Load credentials ─────────────────────────────────────────────────────────

const env = readFileSync('.env', 'utf8');

function getEnvVar(name) {
  // Check process.env first, then .env file
  if (process.env[name]) return process.env[name];
  const m = env.match(new RegExp(`${name}="([^"]+)"`));
  return m?.[1] ?? null;
}

const accessKeyId     = getEnvVar('AWS_ACCESS_KEY_ID');
const secretAccessKey = getEnvVar('AWS_SECRET_ACCESS_KEY');
const sessionToken    = getEnvVar('AWS_SESSION_TOKEN');

// Extract AccessKeyId + SessionToken from Bearer token if not set explicitly
const bearerToken = getEnvVar('VITE_AWS_BEARER_TOKEN_BEDROCK');
const resolvedAccessKeyId = accessKeyId ?? (() => {
  const b64 = bearerToken?.replace('bedrock-api-key-', '') ?? '';
  const qs = Buffer.from(b64, 'base64').toString().split('?')[1] ?? '';
  return new URLSearchParams(qs).get('X-Amz-Credential')?.split('/')[0] ?? null;
})();
const resolvedSessionToken = sessionToken ?? (() => {
  const b64 = bearerToken?.replace('bedrock-api-key-', '') ?? '';
  const qs = Buffer.from(b64, 'base64').toString().split('?')[1] ?? '';
  return decodeURIComponent(new URLSearchParams(qs).get('X-Amz-Security-Token') ?? '');
})();

if (!resolvedAccessKeyId || !secretAccessKey) {
  console.error('❌ Missing AWS credentials. Need AWS_SECRET_ACCESS_KEY in .env');
  process.exit(1);
}

console.log('✅ AccessKeyId:', resolvedAccessKeyId.slice(0, 8) + '...');

// ─── Audio recording ──────────────────────────────────────────────────────────

const RECORD_SECONDS = 5;

function getAudioDevice() {
  switch (process.platform) {
    case 'darwin': return 'avfoundation';
    case 'win32':  return 'dshow';
    default:       return 'alsa';
  }
}
function getAudioInput() {
  switch (process.platform) {
    case 'darwin': return ':0';
    case 'win32':  return 'audio=Microphone Array (Realtek High Definition Audio(SST))';
    default:       return 'default';
  }
}

function recordAudio(seconds) {
  return new Promise((resolve, reject) => {
    console.log(`\n🎙️  Recording ${seconds}s — speak now!`);
    const chunks = [];
    const ffmpeg = spawn('ffmpeg', [
      '-f', getAudioDevice(), '-i', getAudioInput(),
      '-t', String(seconds),
      '-ar', '16000', '-ac', '1',
      '-f', 's16le',  // raw 16-bit PCM (LPCM) — no WAV header
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    ffmpeg.stdout.on('data', c => chunks.push(c));
    ffmpeg.stderr.on('data', () => {});
    ffmpeg.on('close', code => {
      if (code !== 0 && chunks.length === 0) return reject(new Error(`ffmpeg exit ${code}`));
      console.log('✅ Recording done');
      resolve(Buffer.concat(chunks));
    });
    ffmpeg.on('error', reject);
  });
}

// ─── Nova Sonic ───────────────────────────────────────────────────────────────

async function runNovaSonic(pcmBuffer) {
  const client = new BedrockRuntimeClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: resolvedAccessKeyId,
      secretAccessKey,
      ...(resolvedSessionToken ? { sessionToken: resolvedSessionToken } : {}),
    },
    requestHandler: new NodeHttp2Handler({
      requestTimeout: 60000,
      sessionTimeout: 60000,
    }),
  });

  const promptName      = randomUUID();
  const systemContentId = randomUUID();
  const audioContentId  = randomUUID();

  const events = [];
  const add = (obj) => events.push(Buffer.from(JSON.stringify(obj)));

  // Session start
  add({ event: { sessionStart: { inferenceConfiguration: { maxTokens: 1024, topP: 0.9, temperature: 0.7 } } } });

  // Prompt start
  add({ event: { promptStart: {
    promptName,
    textOutputConfiguration: { mediaType: 'text/plain' },
    audioOutputConfiguration: {
      mediaType: 'audio/lpcm', sampleRateHertz: 24000, sampleSizeBits: 16,
      channelCount: 1, voiceId: 'matthew', encoding: 'base64', audioType: 'SPEECH',
    },
  } } });

  // System prompt
  add({ event: { contentStart: { promptName, contentName: systemContentId, type: 'TEXT', interactive: false, role: 'SYSTEM', textInputConfiguration: { mediaType: 'text/plain' } } } });
  add({ event: { textInput: { promptName, contentName: systemContentId, content: 'You are a helpful shopping assistant. Keep responses short and friendly.' } } });
  add({ event: { contentEnd: { promptName, contentName: systemContentId } } });

  // Audio content start
  add({ event: { contentStart: {
    promptName, contentName: audioContentId,
    type: 'AUDIO', interactive: true, role: 'USER',
    audioInputConfiguration: {
      mediaType: 'audio/lpcm', sampleRateHertz: 16000, sampleSizeBits: 16,
      channelCount: 1, audioType: 'SPEECH', encoding: 'base64',
    },
  } } });

  // Audio chunks (1024 bytes = 32ms at 16kHz mono 16-bit)
  for (let i = 0; i < pcmBuffer.length; i += 1024) {
    add({ event: { audioInput: { promptName, contentName: audioContentId, content: pcmBuffer.slice(i, i + 1024).toString('base64') } } });
  }

  // End audio, prompt, session
  add({ event: { contentEnd: { promptName, contentName: audioContentId } } });
  add({ event: { promptEnd: { promptName } } });
  add({ event: { sessionEnd: {} } });

  console.log(`\n📡 Sending ${events.length} events to Nova Sonic...`);

  // Stream events with small delays so Nova Sonic can process them
  async function* makeIterable() {
    for (const payload of events) {
      yield { chunk: { bytes: payload } };
      await new Promise(r => setTimeout(r, 10));
    }
  }

  const response = await client.send(
    new InvokeModelWithBidirectionalStreamCommand({
      modelId: 'amazon.nova-2-sonic-v1:0',
      body: makeIterable(),
    })
  );

  const audioChunks = [];
  let transcriptUser = '';
  let transcriptAssistant = '';
  let role = '';

  console.log('📥 Receiving...\n');

  for await (const event of response.body) {
    if (!event.chunk?.bytes) continue;
    let json;
    try { json = JSON.parse(new TextDecoder().decode(event.chunk.bytes)); } catch { continue; }
    const ev = json.event;
    if (!ev) continue;

    if (ev.contentStart)  { role = ev.contentStart.role; }
    else if (ev.textOutput) {
      const t = ev.textOutput.content;
      if (role === 'USER') { transcriptUser += t; process.stdout.write(`[User] ${t}`); }
      else { transcriptAssistant += t; process.stdout.write(`[Asst] ${t}`); }
    } else if (ev.audioOutput) {
      audioChunks.push(Buffer.from(ev.audioOutput.content, 'base64'));
    }
  }

  return { audioChunks, transcriptUser, transcriptAssistant };
}

// ─── WAV writer ───────────────────────────────────────────────────────────────

function writeWav(pcm, sampleRate, path) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22); h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  writeFileSync(path, Buffer.concat([h, pcm]));
  console.log(`\n💾 Saved: ${path} (${(pcm.length / 1024).toFixed(1)} KB)`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

try {
  const pcm = await recordAudio(RECORD_SECONDS);
  const { audioChunks, transcriptUser, transcriptAssistant } = await runNovaSonic(pcm);

  console.log('\n\n📊 Results:');
  console.log('  User transcript    :', transcriptUser || '(none)');
  console.log('  Assistant response :', transcriptAssistant || '(none)');
  console.log('  Audio chunks       :', audioChunks.length);

  if (audioChunks.length > 0) {
    writeWav(Buffer.concat(audioChunks), 24000, 'nova-sonic-response.wav');
    console.log('  ▶ Play: ffplay -ar 24000 -ac 1 -f s16le nova-sonic-response.wav');
  } else {
    console.log('  ⚠️  No audio output received');
  }
} catch (e) {
  console.error('\n❌ Error:', e.message);
  if (e.$metadata) console.error('   HTTP status:', e.$metadata.httpStatusCode);
  if (e.name) console.error('   Error type:', e.name);
}
