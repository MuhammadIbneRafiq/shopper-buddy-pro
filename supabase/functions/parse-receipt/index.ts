// Parses a receipt photo into structured line items.
// AI-backed when LOVABLE_API_KEY is present, otherwise returns a realistic mock.
import { corsHeaders } from "../_shared/cors.ts";

interface LineItem { name: string; price: number; qty?: number }
interface ParsedReceipt {
  store: string;
  total: number;
  currency: string;
  line_items: LineItem[];
  source: "ai" | "mock";
}

const MOCK: ParsedReceipt = {
  store: "Albert Heijn",
  total: 23.46,
  currency: "EUR",
  source: "mock",
  line_items: [
    { name: "Whole milk 1L", price: 1.29, qty: 2 },
    { name: "Bananas (1kg)", price: 1.69, qty: 1 },
    { name: "Sourdough loaf", price: 3.49, qty: 1 },
    { name: "Greek yogurt 500g", price: 2.99, qty: 1 },
    { name: "Cheddar 200g", price: 4.50, qty: 1 },
    { name: "Sparkling water 1.5L", price: 0.99, qty: 3 },
    { name: "Coffee beans 250g", price: 5.99, qty: 1 },
  ],
};

async function callGemini(imageBase64: string, apiKey: string): Promise<ParsedReceipt | null> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "You are the receipt parser agent. Return ONLY JSON {store, total, currency, line_items:[{name,price,qty}]}." },
        { role: "user", content: [
          { type: "text", text: "Parse this supermarket receipt." },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ] },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) return null;
  try {
    const data = await res.json();
    return { ...JSON.parse(data.choices[0].message.content), source: "ai" } as ParsedReceipt;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { imageBase64 } = await req.json();
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    let parsed: ParsedReceipt | null = null;
    if (apiKey && imageBase64) parsed = await callGemini(imageBase64, apiKey);
    if (!parsed) parsed = MOCK;
    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
