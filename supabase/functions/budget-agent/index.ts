// Multi-agent orchestration:
//   1) Recognizer agent (recognize-product) — already gave us {name, price, ...}
//   2) Knowledge-graph agent — looks up typical price + category from products table
//   3) Budget agent — checks remaining grocery budget for current month
//   4) Decision agent — produces a spoken summary + flags whether helper assistance is recommended
// Pure orchestration: requires the user JWT (verifies caller) and uses service role for KG + budget reads.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

interface Guess {
  name: string;
  brand?: string;
  price: number;
  currency: string;
  category: string;
  confidence: number;
}

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

    const { guess } = await req.json() as { guess: Guess };

    // ---- KG agent
    const { data: kgMatch } = await supabase
      .from("products")
      .select("name, brand, typical_price, category")
      .ilike("name", `%${guess.name.split(" ")[0]}%`)
      .limit(1)
      .maybeSingle();

    const typical = kgMatch?.typical_price ?? guess.price;
    const priceVerdict =
      guess.price > typical * 1.25 ? "expensive" :
      guess.price < typical * 0.85 ? "good_deal" : "typical";

    // ---- Budget agent
    const periodStart = new Date(); periodStart.setDate(1);
    const { data: budget } = await supabase
      .from("grocery_budgets")
      .select("monthly_limit, currency")
      .eq("user_id", user.id)
      .order("period_start", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: txs } = await supabase
      .from("transactions")
      .select("amount")
      .eq("user_id", user.id)
      .gte("occurred_at", periodStart.toISOString());

    const spent = (txs ?? []).reduce((s, t) => s + Number(t.amount), 0);
    const limit = Number(budget?.monthly_limit ?? 400);
    const remaining = Math.max(0, limit - spent);
    const wouldExceed = guess.price > remaining;

    // ---- Decision agent
    const recommendHelper = guess.confidence < 0.7 || wouldExceed;
    const speak =
      `${guess.name}${guess.brand ? ` by ${guess.brand}` : ""}, ${guess.currency} ${guess.price.toFixed(2)}. ` +
      (priceVerdict === "expensive" ? `That's pricier than the typical ${typical.toFixed(2)}. ` :
       priceVerdict === "good_deal" ? `That's a good price, typically ${typical.toFixed(2)}. ` : "") +
      (wouldExceed
        ? `Heads up: this would exceed your remaining grocery budget of ${remaining.toFixed(2)}.`
        : `You'll have ${(remaining - guess.price).toFixed(2)} left in your monthly grocery budget.`);

    return new Response(JSON.stringify({
      product: guess,
      kg: { typical_price: typical, verdict: priceVerdict, matched: !!kgMatch },
      budget: { spent, limit, remaining, currency: budget?.currency ?? "EUR", would_exceed: wouldExceed },
      recommend_helper: recommendHelper,
      speak,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
