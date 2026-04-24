const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const tok = env.match(/VITE_AWS_BEARER_TOKEN_BEDROCK="([^"]+)"/)[1];

fetch('https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-haiku-20240307-v1:0/converse', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
  body: JSON.stringify({ messages: [{ role: 'user', content: [{ text: 'say hi' }] }] })
}).then(r => {
  console.log('HTTP STATUS:', r.status);
  return r.json();
}).then(d => {
  if (d.output) console.log('OK - Response:', d.output.message.content[0].text);
  else console.log('ERROR body:', JSON.stringify(d).substring(0, 300));
}).catch(e => console.log('NETWORK ERROR:', e.message));
