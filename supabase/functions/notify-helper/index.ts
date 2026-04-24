// Notifies the linked helper of a request:
//  1) writes the helper_request row (in-app inbox)
//  2) attempts WhatsApp send via Meta Cloud API using WHATSAPP_TOKEN env (dummy by default — flag whatsapp_sent=false on failure)
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

    const { kind, question, image_url, ai_summary } = await req.json();

    const { data: joint } = await supabase
      .from("joint_accounts")
      .select("helper_user_id, helper_email")
      .eq("primary_user_id", user.id)
      .maybeSingle();

    const { data: inserted, error: insErr } = await supabase
      .from("helper_requests")
      .insert({
        primary_user_id: user.id,
        helper_user_id: joint?.helper_user_id ?? null,
        kind: kind ?? "general",
        question,
        image_url,
        ai_summary,
      })
      .select()
      .single();

    if (insErr) throw insErr;

    // WhatsApp attempt (works the moment a real WHATSAPP_TOKEN + WHATSAPP_PHONE_ID are added)
    const waToken = Deno.env.get("WHATSAPP_TOKEN") ?? "DUMMY_WA_TOKEN_PLACEHOLDER";
    const waPhoneId = Deno.env.get("WHATSAPP_PHONE_ID") ?? "DUMMY_PHONE_ID";
    let whatsappSent = false;
    let whatsappError: string | null = null;

    if (joint?.helper_email && waToken !== "DUMMY_WA_TOKEN_PLACEHOLDER") {
      try {
        const r = await fetch(`https://graph.facebook.com/v20.0/${waPhoneId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: joint.helper_email,
            type: "text",
            text: { body: `Help requested: ${question ?? ai_summary ?? "Please open the app."}` },
          }),
        });
        whatsappSent = r.ok;
        if (!r.ok) whatsappError = `WhatsApp ${r.status}`;
      } catch (e) {
        whatsappError = String(e);
      }
    } else {
      whatsappError = "Using dummy WhatsApp token — message logged in-app only.";
    }

    if (whatsappSent) {
      await supabase.from("helper_requests").update({ whatsapp_sent: true }).eq("id", inserted.id);
    }

    return new Response(JSON.stringify({
      request: inserted,
      whatsapp_sent: whatsappSent,
      whatsapp_note: whatsappError,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
