// test-polly.mjs
// Tests AWS Polly TTS using the same bearer token as Bedrock
import { readFileSync, writeFileSync } from 'fs';

const env = readFileSync('.env', 'utf8');
const token = env.match(/VITE_AWS_BEARER_TOKEN_BEDROCK="([^"]+)"/)[1];

const body = JSON.stringify({
  Text: 'Hello, I found Campina halfvolle melk, one litre, one euro twenty nine cents. Would you like to add this to your basket?',
  OutputFormat: 'mp3',
  VoiceId: 'Joanna',  // neural English voice
  Engine: 'neural',
});

const res = await fetch('https://polly.us-east-1.amazonaws.com/v1/speech', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token,
  },
  body,
});

console.log('Status:', res.status);
if (res.ok) {
  const buf = await res.arrayBuffer();
  writeFileSync('test-polly-output.mp3', Buffer.from(buf));
  console.log('Saved test-polly-output.mp3 -', buf.byteLength, 'bytes');
} else {
  const err = await res.text();
  console.log('Error:', err.slice(0, 300));
}
