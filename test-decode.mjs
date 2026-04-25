import { readFileSync } from 'fs';
const t = readFileSync('.env','utf8').match(/VITE_AWS_BEARER_TOKEN_BEDROCK="([^"]+)"/)[1];
const d = Buffer.from(t.replace('bedrock-api-key-',''),'base64').toString();
const p = new URLSearchParams(d.split('?')[1]);
console.log('All keys in Bearer token:');
for (const [k,v] of p) console.log(' ', k, '=', v.slice(0,30)+'...');
