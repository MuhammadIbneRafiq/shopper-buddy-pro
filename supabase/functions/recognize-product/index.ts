// Recognizes a product from a base64 image.
// When LOVABLE_API_KEY is present, calls Gemini multimodal via Lovable AI Gateway.
// Otherwise, returns a deterministic mock with the same JSON shape so the app keeps working.
import { corsHeaders } from "../_shared/cors.ts";

interface ProductGuess {
  name: string;
  brand?: string;
  price: number;
  currency: string;
  category: string;
  confidence: number;
  source: "ai" | "mock";
}

const MOCK_POOL: ProductGuess[] = [
  { name: "Whole milk 1L", brand: "AH", price: 1.29, currency: "EUR", category: "milk", confidence: 0.92, source: "mock" },
  { name: "Bananas (1kg)", price: 1.69, currency: "EUR", category: "fruit", confidence: 0.88, source: "mock" },
  { name: "Greek yogurt 500g", brand: "Fage", price: 2.99, currency: "EUR", category: "yogurt", confidence: 0.90, source: "mock" },
  { name: "Sourdough loaf", brand: "Bakery", price: 3.49, currency: "EUR", category: "bakery", confidence: 0.81, source: "mock" },
  { name: "Cheddar 200g", brand: "Old Amsterdam", price: 4.50, currency: "EUR", category: "cheese", confidence: 0.78, source: "mock" },
  { name: "Sparkling water 1.5L", brand: "Spa", price: 0.99, currency: "EUR", category: "water", confidence: 0.95, source: "mock" },
];

async function callGemini(imageBase64: string, apiKey: string): Promise<ProductGuess | null> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content:
            "You are the recognizer agent in a multi-agent grocery assistant for visually impaired users. Identify the product. Return ONLY JSON: {name, brand?, price, currency, category, confidence}. Estimate price from packaging if visible, else typical EU supermarket price.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Identify this product." },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          ],
        },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  try {
    const parsed = JSON.parse(data.choices[0].message.content);
    return { ...parsed, source: "ai" } as ProductGuess;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { imageBase64 } = await req.json();
    const apiKey = Deno.env.get("LOVABLE_API_KEY");

    let guess: ProductGuess | null = null;
    if (apiKey && imageBase64) guess = await callGemini(imageBase64, apiKey);
    if (!guess) {
      // Deterministic mock pick based on image bytes length so it feels stable per shot.
      const idx = (imageBase64?.length ?? 0) % MOCK_POOL.length;
      guess = MOCK_POOL[idx];
    }

    return new Response(JSON.stringify(guess), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
