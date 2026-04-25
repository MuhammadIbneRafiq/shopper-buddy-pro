/**
 * POST /api/nova-sonic
 * Body: { audioBase64: string, systemPrompt?: string }
 * Returns: { transcript: string, audioBase64: string }
 *
 * Sends user audio to Nova Sonic bidirectional stream.
 * Returns the user transcript and assistant TTS audio (24kHz mono PCM, base64).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'crypto';
import { BedrockRuntimeClient, InvokeModelWithBidirectionalStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttp2Handler } from '@smithy/node-http-handler';

function getClient() {
  return new BedrockRuntimeClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
    },
    requestHandler: new NodeHttp2Handler({ requestTimeout: 60000, sessionTimeout: 60000 }),
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { audioBase64, systemPrompt = 'You are a helpful shopping assistant. Keep responses short.' } = req.body;
  if (!audioBase64) return res.status(400).json({ error: 'audioBase64 required' });
  if (!process.env.AWS_SECRET_ACCESS_KEY) return res.status(500).json({ error: 'AWS credentials not configured' });

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

  // Split audio into 1024-byte chunks
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

  try {
    const response = await getClient().send(
      new InvokeModelWithBidirectionalStreamCommand({ modelId: 'amazon.nova-2-sonic-v1:0', body: stream() })
    );

    const audioChunks: Buffer[] = [];
    let transcript = '';
    let role = '';

    for await (const event of response.body) {
      if (!event.chunk?.bytes) continue;
      let json: any;
      try { json = JSON.parse(new TextDecoder().decode(event.chunk.bytes)); } catch { continue; }
      const ev = json.event;
      if (!ev) continue;
      if (ev.contentStart) role = ev.contentStart.role;
      else if (ev.textOutput && role === 'USER') transcript += ev.textOutput.content;
      else if (ev.audioOutput) audioChunks.push(Buffer.from(ev.audioOutput.content, 'base64'));
    }

    res.json({ transcript, audioBase64: Buffer.concat(audioChunks).toString('base64') });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
