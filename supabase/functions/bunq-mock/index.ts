// Mocked bunq API — same response shape as bunq's real /v1/user/{id}/monetary-account endpoints.
// Swap the body of this function with real bunq calls (using BUNQ_API_KEY secret) without touching the frontend.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const user = userData.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action } = await req.json();

    if (action === "seed") {
      // Insert 6 fake grocery transactions for this month
      const now = new Date();
      const samples = [
        { merchant: "Albert Heijn", amount: 23.46, daysAgo: 1 },
        { merchant: "Lidl", amount: 18.20, daysAgo: 4 },
        { merchant: "Jumbo", amount: 31.05, daysAgo: 7 },
        { merchant: "Albert Heijn", amount: 12.80, daysAgo: 10 },
        { merchant: "Marqt", amount: 27.55, daysAgo: 14 },
        { merchant: "Albert Heijn", amount: 9.99, daysAgo: 18 },
      ];
      const rows = samples.map((s) => ({
        user_id: user.id,
        merchant: s.merchant,
        amount: s.amount,
        currency: "EUR",
        category: "groceries",
        occurred_at: new Date(now.getTime() - s.daysAgo * 86400000).toISOString(),
        source: "bunq_mock",
      }));
      await supabase.from("transactions").delete().eq("user_id", user.id).eq("source", "bunq_mock");
      await supabase.from("transactions").insert(rows);
      return new Response(JSON.stringify({ ok: true, inserted: rows.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // default: return mocked balance + this month spend
    const periodStart = new Date(); periodStart.setDate(1);
    const { data: txs } = await supabase
      .from("transactions").select("amount")
      .eq("user_id", user.id)
      .gte("occurred_at", periodStart.toISOString());
    const spent = (txs ?? []).reduce((s, t) => s + Number(t.amount), 0);

    return new Response(JSON.stringify({
      account: { type: "MonetaryAccountBank", description: "Daily account", currency: "EUR", balance: { value: (1842.55 - spent).toFixed(2), currency: "EUR" } },
      grocery_spent_this_month: spent,
      source: "bunq_mock",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
