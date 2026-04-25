import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CheckCircle2, Clock, MessageCircle } from "lucide-react";

interface Req {
  id: string; primary_user_id: string; kind: string; question: string | null;
  ai_summary: string | null; helper_response: string | null; status: string;
  created_at: string; whatsapp_sent: boolean;
}

export default function Inbox() {
  const [reqs, setReqs] = useState<Req[]>([]);
  const [responses, setResponses] = useState<Record<string, string>>({});

  async function load() {
    const { data } = await supabase.from("helper_requests").select("*").order("created_at", { ascending: false });
    setReqs((data as any[]) ?? []);
  }
  useEffect(() => {
    load();
    const ch = supabase.channel("hr").on("postgres_changes",
      { event: "*", schema: "public", table: "helper_requests" }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function answer(r: Req) {
    const text = responses[r.id]?.trim();
    if (!text) return;
    const { error } = await supabase.from("helper_requests").update({
      helper_response: text, status: "answered", answered_at: new Date().toISOString(),
    }).eq("id", r.id);
    if (error) toast.error(error.message); else { toast.success("Reply sent"); setResponses((s) => ({ ...s, [r.id]: "" })); load(); }
  }

  return (
    <section className="container mx-auto px-4 py-6 max-w-3xl">
      <h1 className="text-3xl font-bold mb-2">Helper inbox</h1>
      <p className="text-muted-foreground mb-6">Open questions from people you support.</p>

      <div className="space-y-4">
        {reqs.length === 0 && <p className="text-center text-muted-foreground py-8">No requests yet.</p>}
        {reqs.map((r) => (
          <Card key={r.id} className="p-5 shadow-soft">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs uppercase tracking-wide px-2 py-1 rounded-full bg-accent text-accent-foreground">{r.kind.replace("_", " ")}</span>
              <span className={`text-sm flex items-center gap-1 ${r.status === "answered" ? "text-success" : "text-warning"}`}>
                {r.status === "answered" ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                {r.status}
              </span>
            </div>
            {r.question && <p className="text-lg font-medium mb-2">{r.question}</p>}
            {r.ai_summary && <p className="text-sm text-muted-foreground mb-3 italic">AI: {r.ai_summary}</p>}

            {r.status === "answered" ? (
              <div className="rounded-xl bg-success/10 text-success p-3 flex gap-2">
                <MessageCircle className="w-5 h-5 shrink-0" />
                <p>{r.helper_response}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Textarea placeholder="Type your reply" value={responses[r.id] ?? ""}
                  onChange={(e) => setResponses((s) => ({ ...s, [r.id]: e.target.value }))} rows={2} />
                <Button onClick={() => answer(r)} className="w-full h-12">Send reply</Button>
              </div>
            )}

            <div className="mt-3 text-xs text-muted-foreground flex justify-between">
              <span>{new Date(r.created_at).toLocaleString()}</span>
              <span>{r.whatsapp_sent ? "WhatsApp sent" : "in-app only"}</span>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
