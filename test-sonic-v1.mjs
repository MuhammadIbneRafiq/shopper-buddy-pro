import { readFileSync } from 'fs';
const env = readFileSync('.env', 'utf8');
const token = env.match(/VITE_AWS_BEARER_TOKEN_BEDROCK="([^"]+)"/)?.[1];

// Try a simple invoke (not bidirectional) just to see what error we get
const res = await fetch(
  'https://bedrock-runtime.us-east-1.amazonaws.com/model/amazon.nova-sonic-v1%3A0/invoke',
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ inputText: 'hello' })
  }
);
console.log('nova-sonic-v1 /invoke status:', res.status);
console.log(await res.text());
