import type { VercelRequest, VercelResponse } from '@vercel/node';

const BEDROCK_URL =
  'https://bedrock-runtime.us-east-1.amazonaws.com/model/amazon.nova-2-multimodal-embeddings-v1:0/invoke';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { audioBase64 } = req.body as { audioBase64?: string };
  if (!audioBase64) return res.status(400).json({ error: 'audioBase64 required' });

  const token = process.env.VITE_AWS_BEARER_TOKEN_BEDROCK;
  if (!token) return res.status(500).json({ error: 'AWS token not configured' });

  const payload = {
    schemaVersion: 'nova-multimodal-embed-v1',
    taskType: 'SINGLE_EMBEDDING',
    singleEmbeddingParams: {
      embeddingPurpose: 'GENERIC_INDEX',
      embeddingDimension: 1024,
      audio: { format: 'wav', source: { bytes: audioBase64 } },
    },
  };

  const upstream = await fetch(BEDROCK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    return res.status(upstream.status).json({ error: text });
  }

  const data = await upstream.json();
  const embedding: number[] = data.embeddings?.[0]?.embedding ?? [];
  return res.status(200).json({ embedding });
}
