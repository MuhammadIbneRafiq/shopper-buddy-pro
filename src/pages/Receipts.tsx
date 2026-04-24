import { useEffect, useState } from "react";
import { Camera, Upload, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { speak } from "@/lib/speech";

interface Receipt {
  id: string; store: string | null; total: number | null; currency: string;
  line_items: { name: string; price: number; qty?: number }[];
  occurred_at: string;
}

export default function Receipts() {
  const [busy, setBusy] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);

  async function load() {
    const { data } = await supabase.from("receipts").select("*").order("occurred_at", { ascending: false });
    setReceipts((data as any[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  async function uploadReceipt(file?: File) {
    setBusy(true);
    try {
      let imageBase64 = "";
      if (file) {
        imageBase64 = await new Promise<string>((res) => {
          const r = new FileReader();
          r.onload = () => res((r.result as string).split(",")[1]);
          r.readAsDataURL(file);
        });
      }
      const { data: parsed, error } = await supabase.functions.invoke("parse-receipt", { body: { imageBase64 } });
      if (error) throw error;

      const { data: { user } } = await supabase.auth.getUser();
      const { error: insErr } = await supabase.from("receipts").insert({
        user_id: user!.id,
        store: parsed.store,
        total: parsed.total,
        currency: parsed.currency,
        line_items: parsed.line_items,
      });
      if (insErr) throw insErr;

      // Also log a transaction
      await supabase.from("transactions").insert({
        user_id: user!.id,
        merchant: parsed.store,
        amount: parsed.total,
        currency: parsed.currency,
        category: "groceries",
      });

      toast.success("Receipt parsed and logged");
      speak(`Parsed receipt from ${parsed.store}. Total ${parsed.currency} ${parsed.total.toFixed(2)}, ${parsed.line_items.length} items.`);
      load();
    } catch (e: any) {
      toast.error(e.message ?? "Couldn't parse receipt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="container mx-auto px-4 py-6 max-w-3xl">
      <h1 className="text-3xl font-bold mb-2">Receipts</h1>
      <p className="text-muted-foreground mb-6">Snap a receipt and we'll itemize and log it.</p>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="cursor-pointer">
          <input type="file" accept="image/*" capture="environment" hidden
            onChange={(e) => e.target.files?.[0] && uploadReceipt(e.target.files[0])} />
          <Button asChild size="lg" className="h-16 w-full text-lg gradient-hero text-primary-foreground border-0">
            <span><Camera className="w-5 h-5 mr-2" /> Take photo</span>
          </Button>
        </label>
        <Button onClick={() => uploadReceipt()} disabled={busy} size="lg" variant="outline" className="h-16 text-lg">
          {busy ? <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> : <Upload className="w-5 h-5 mr-2" />}
          {busy ? "Parsing…" : "Demo receipt"}
        </Button>
      </div>

      <div className="mt-8 space-y-4">
        {receipts.length === 0 && <p className="text-center text-muted-foreground py-8">No receipts yet.</p>}
        {receipts.map((r) => (
          <Card key={r.id} className="p-5 shadow-soft">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="text-xl font-bold">{r.store ?? "Unknown store"}</h3>
                <p className="text-sm text-muted-foreground">{new Date(r.occurred_at).toLocaleDateString()}</p>
              </div>
              <div className="text-2xl font-bold text-primary">{r.currency} {Number(r.total ?? 0).toFixed(2)}</div>
            </div>
            <ul className="divide-y">
              {(r.line_items ?? []).map((it, i) => (
                <li key={i} className="py-2 flex justify-between text-base">
                  <span>{it.name}{it.qty && it.qty > 1 ? ` ×${it.qty}` : ""}</span>
                  <span className="font-medium">{r.currency} {Number(it.price).toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </section>
  );
}
