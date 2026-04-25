import type { VercelRequest, VercelResponse } from '@vercel/node';

const BUNQ_BASE = 'https://public-api.sandbox.bunq.com/v1';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const suffix = (req.url ?? '').replace(/^\/api\/bunq/, '');
  const targetUrl = `${BUNQ_BASE}${suffix}`;

  const token = process.env.VITE_BUNQ_SESSION_TOKEN;
  const forwardHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'none',
    'User-Agent': 'shopper-buddy',
    'X-Bunq-Client-Request-Id': 'r' + Date.now() + Math.random().toString(36).slice(2),
    'X-Bunq-Language': 'en_US',
    'X-Bunq-Region': 'nl_NL',
    'X-Bunq-Geolocation': '0 0 0 0 000',
  };
  if (token) forwardHeaders['X-Bunq-Client-Authentication'] = token;

  try {
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      ...(hasBody && req.body ? { body: JSON.stringify(req.body) } : {}),
    });
    const text = await upstream.text();
    res.status(upstream.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
