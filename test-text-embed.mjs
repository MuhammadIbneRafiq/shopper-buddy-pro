import { readFileSync } from 'fs';
import { spawn } from 'child_process';

const env = readFileSync('.env', 'utf8');
const token = env.match(/VITE_AWS_BEARER_TOKEN_BEDROCK="([^"]+)"/)?.[1];

function synthesizeWav(phrase) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const ff = spawn('ffmpeg', [
      '-f', 'lavfi', '-i', `flite=text='${phrase}':voice=rms`,
      '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    ff.stdout.on('data', c => chunks.push(c));
    ff.stderr.on('data', () => {});
    ff.on('close', code => {
      if (code !== 0 && chunks.length === 0) return reject(new Error(`ffmpeg exit ${code}`));
      resolve(Buffer.concat(chunks));
    });
    ff.on('error', reject);
  });
}

const wav = await synthesizeWav('scan this add to cart');
console.log('WAV size:', wav.length, 'bytes');

const res = await fetch('https://bedrock-runtime.us-east-1.amazonaws.com/model/amazon.nova-2-multimodal-embeddings-v1:0/invoke', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ schemaVersion: 'nova-multimodal-embed-v1', taskType: 'SINGLE_EMBEDDING', singleEmbeddingParams: { embeddingPurpose: 'GENERIC_INDEX', embeddingDimension: 1024, audio: { format: 'wav', source: { bytes: wav.toString('base64') } } } })
});
console.log('Status:', res.status);
const d = await res.json();
const emb = d.embeddings?.[0]?.embedding;
console.log('Embedding dims:', emb?.length ?? 'NONE');
console.log('First 3 vals:', emb?.slice(0, 3));
