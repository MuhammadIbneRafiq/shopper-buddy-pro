/**
 * RAG module — matches a scanned product against the Dutch supermarket dataset
 * using Bedrock Claude with the full product catalog injected as context.
 * Falls back to local fuzzy match if Bedrock is unavailable.
 */
import PRODUCTS from '@/data/dutch-products.json';

export interface DutchProduct {
  id: string;
  name: string;
  brand: string;
  category: string;
  subcategory: string;
  price: number;
  unit: string;
  barcode: string;
  supermarket: string;
  allergens: string[];
  tags: string[];
  description: string;
}

const catalog = PRODUCTS as DutchProduct[];

// Build compact catalog string for context injection
const CATALOG_CONTEXT = catalog.map(p =>
  `[${p.id}] ${p.name} | ${p.brand} | ${p.supermarket} | €${p.price} | ${p.unit} | tags: ${p.tags.join(',')}`
).join('\n');

function getCredentials() {
  return {
    accessKeyId: import.meta.env.VITE_AWS_ACCESS_KEY_ID as string,
    secretAccessKey: import.meta.env.VITE_AWS_SECRET_ACCESS_KEY as string,
    sessionToken: import.meta.env.VITE_AWS_SESSION_TOKEN as string,
  };
}

// Local fuzzy fallback — score by tag/name overlap
function localFuzzyMatch(query: string): DutchProduct | null {
  const q = query.toLowerCase();
  let best: DutchProduct | null = null;
  let bestScore = 0;
  for (const p of catalog) {
    const haystack = [p.name, p.brand, p.category, ...p.tags].join(' ').toLowerCase();
    const words = q.split(/\s+/);
    const score = words.filter(w => w.length > 2 && haystack.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return bestScore > 0 ? best : null;
}

/**
 * Given a raw product description from Claude's vision scan,
 * find the best matching Dutch supermarket product with real price.
 */
export async function ragLookup(rawProduct: { name: string; brand: string; description: string }): Promise<DutchProduct | null> {
  const creds = getCredentials();
  if (!creds.accessKeyId) return localFuzzyMatch(`${rawProduct.name} ${rawProduct.brand}`);

  try {
    const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: 'us-east-1', credentials: creds });

    const prompt = `You are a Dutch supermarket product matcher. Given a scanned product, find the best match from the catalog.

SCANNED PRODUCT:
Name: ${rawProduct.name}
Brand: ${rawProduct.brand}
Description: ${rawProduct.description}

DUTCH SUPERMARKET CATALOG:
${CATALOG_CONTEXT}

Return ONLY the product ID (e.g. "ah-001") of the best match, or "none" if no match. No explanation.`;

    const res = await client.send(new ConverseCommand({
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      messages: [{ role: 'user', content: [{ text: prompt }] }],
    }));

    const matchId = res.output?.message?.content?.[0]?.text?.trim().toLowerCase();
    if (!matchId || matchId === 'none') return localFuzzyMatch(`${rawProduct.name} ${rawProduct.brand}`);
    return catalog.find(p => p.id === matchId) ?? localFuzzyMatch(`${rawProduct.name} ${rawProduct.brand}`);
  } catch {
    return localFuzzyMatch(`${rawProduct.name} ${rawProduct.brand}`);
  }
}

/**
 * Multimodal scan: send image to Claude, get product JSON, then RAG-match it.
 */
export async function scanAndMatch(base64Image: string): Promise<DutchProduct & { tts: string } | null> {
  const creds = getCredentials();
  if (!creds.accessKeyId) return null;

  try {
    const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: 'us-east-1', credentials: creds });

    // Step 1: Vision — identify the product
    const visionRes = await client.send(new ConverseCommand({
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      system: [{ text: 'You identify grocery products from images. Output ONLY valid JSON: {"name":"...","brand":"...","category":"...","description":"..."}' }],
      messages: [{ role: 'user', content: [
        { image: { format: 'jpeg', source: { bytes: base64Image } } },
        { text: 'Identify this product.' }
      ]}],
    }));

    const raw = visionRes.output?.message?.content?.[0]?.text ?? '';
    let parsed: { name: string; brand: string; category: string; description: string };
    try {
      const match = raw.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match?.[0] ?? raw);
    } catch {
      return null;
    }

    // Step 2: RAG match against Dutch catalog
    const matched = await ragLookup(parsed);
    if (!matched) return null;

    return {
      ...matched,
      tts: `${matched.name} van ${matched.brand}, ${matched.supermarket}, ${matched.unit}, prijs ${matched.price.toFixed(2)} euro.`,
    };
  } catch {
    return null;
  }
}
