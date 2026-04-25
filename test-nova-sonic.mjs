import { readFileSync } from 'fs';
import { spawn } from 'child_process';

const env = readFileSync('.env', 'utf8');
const token = env.match(/VITE_AWS_BEARER_TOKEN_BEDROCK="([^"]+)"/)?.[1];
console.log('Token found:', token ? `YES (${token.slice(0, 20)}...)` : 'NO');
if (!token) { console.error('No token'); process.exit(1); }
const RECORD_SECONDS = 5;

function recordAudio(seconds) {
  return new Promise((resolve, reject) => {
    console.log(`🎙️  Recording for ${seconds} seconds... speak now!`);

    const chunks = [];

    // ffmpeg: capture from default mic, output raw PCM as WAV to stdout
    const ffmpeg = spawn('ffmpeg', [
      '-f', getAudioDevice(),   // platform audio input
      '-i', getAudioInput(),    // default input device
      '-t', String(seconds),    // duration
      '-ar', '16000',           // 16kHz sample rate
      '-ac', '1',               // mono
      '-f', 'wav',              // WAV format
      'pipe:1',                 // output to stdout
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    ffmpeg.stdout.on('data', chunk => chunks.push(chunk));
    ffmpeg.stderr.on('data', () => { }); // suppress ffmpeg logs

    ffmpeg.on('close', code => {
      if (code !== 0 && chunks.length === 0) {
        reject(new Error(`ffmpeg exited with code ${code}`));
      } else {
        console.log('✅ Recording done!');
        resolve(Buffer.concat(chunks));
      }
    });

    ffmpeg.on('error', reject);
  });
}

function getAudioDevice() {
  switch (process.platform) {
    case 'darwin': return 'avfoundation';
    case 'win32': return 'dshow';
    default: return 'alsa';          // Linux
  }
}

function getAudioInput() {
  switch (process.platform) {
    case 'darwin': return ':0';            // first mic on Mac
    case 'win32': return 'audio=Microphone Array (Realtek High Definition Audio(SST))';
    default: return 'default';       // Linux ALSA default
  }
}

async function getEmbedding(audioBuffer) {
  const payload = {
    schemaVersion: 'nova-multimodal-embed-v1',
    taskType: 'SINGLE_EMBEDDING',
    singleEmbeddingParams: {
      embeddingPurpose: 'GENERIC_INDEX',
      embeddingDimension: 1024,
      audio: {
        format: 'wav',
        source: { bytes: audioBuffer.toString('base64') }
      }
    }
  };

  console.log('📡 Sending to Nova Multimodal Embeddings...');

  const res = await fetch(
    'https://bedrock-runtime.us-east-1.amazonaws.com/model/amazon.nova-2-multimodal-embeddings-v1:0/invoke',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) throw Object.assign(new Error(await res.text()), { $metadata: { httpStatusCode: res.status } });
  return res.json();
}

// --- Main ---
try {
  const audioBuffer = await recordAudio(RECORD_SECONDS);
  const result = await getEmbedding(audioBuffer);

  console.log('\n📊 Embedding result:');
  console.log('  Dimensions :', result.embeddings?.[0]?.embedding?.length ?? 'unknown');
  console.log('  First 5 vals:', result.embeddings?.[0]?.embedding?.slice(0, 5));
} catch (e) {
  console.error('❌ Error:', e.message);
  if (e.$metadata) console.error('   HTTP status:', e.$metadata.httpStatusCode);
}