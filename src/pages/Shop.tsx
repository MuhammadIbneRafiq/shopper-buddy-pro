import { useEffect, useRef, useState } from "react";
import { Camera, Mic, RefreshCw, AlertTriangle, CheckCircle2, HelpingHand } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { speak, stopSpeaking } from "@/lib/speech";
import { toast } from "sonner";

interface Verdict {
  product: { name: string; brand?: string; price: number; currency: string; confidence: number; source: string };
  kg: { typical_price: number; verdict: "expensive" | "good_deal" | "typical"; matched: boolean };
  budget: { spent: number; limit: number; remaining: number; currency: string; would_exceed: boolean };
  recommend_helper: boolean;
  speak: string;
}

export default function Shop() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  useEffect(() => () => { stopSpeaking(); stopCam(); }, []);

  async function startCam() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) { videoRef.current.srcObject = s; await videoRef.current.play(); }
      setStreaming(true);
    } catch {
      toast.message("Camera unavailable  using demo mode");
      setStreaming(true);
    }
  }
  function stopCam() {
    const s = videoRef.current?.srcObject as MediaStream | null;
    s?.getTracks().forEach((t) => t.stop());
    setStreaming(false);
  }

  async function captureAndAnalyze() {
    setBusy(true);
    setVerdict(null);
    try {
      let imageBase64 = "";
      if (videoRef.current && canvasRef.current && videoRef.current.videoWidth) {
        const c = canvasRef.current;
        c.width = videoRef.current.videoWidth;
        c.height = videoRef.current.videoHeight;
        c.getContext("2d")!.drawImage(videoRef.current, 0, 0);
        imageBase64 = c.toDataURL("image/jpeg", 0.7).split(",")[1];
      }

      const { data: guess, error: gErr } = await supabase.functions.invoke("recognize-product", {
        body: { imageBase64 },
      });
      if (gErr) throw gErr;

      const { data: v, error: bErr } = await supabase.functions.invoke("budget-agent", {
        body: { guess },
      });
      if (bErr) throw bErr;

      setVerdict(v as Verdict);
      speak((v as Verdict).speak);
    } catch (e: any) {
      toast.error(e.message ?? "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function askHelper() {
    if (!verdict) return;
    const { error } = await supabase.functions.invoke("notify-helper", {
      body: {
        kind: "product_check",
        question: `Can you confirm this product and price? ${verdict.product.name}  ${verdict.product.currency} ${verdict.product.price}`,
        ai_summary: verdict.speak,
      },
    });
    if (error) toast.error(error.message);
    else { toast.success("Helper notified"); speak("Your helper has been notified."); }
  }

  return (
    <section className="container mx-auto px-4 py-6 max-w-3xl">
      <h1 className="text-3xl font-bold mb-2">Shop</h1>
      <p className="text-muted-foreground mb-6">Point at a product, then tap the big button.</p>

      <Card className="overflow-hidden shadow-soft">
        <div className="relative bg-muted aspect-[4/3] flex items-center justify-center">
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
          <canvas ref={canvasRef} className="hidden" />
          {!streaming && (
            <div className="text-center p-8">
              <Camera className="w-16 h-16 mx-auto mb-4 text-muted-foreground" aria-hidden />
              <Button onClick={startCam} size="lg" className="h-14 text-lg gradient-hero text-primary-foreground border-0">
                <Camera className="w-5 h-5 mr-2" /> Start camera
              </Button>
              <p className="text-sm text-muted-foreground mt-3">If no camera, we'll use a demo product.</p>
            </div>
          )}
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Button onClick={captureAndAnalyze} disabled={busy} size="lg"
          className="h-20 text-xl gradient-warm text-secondary-foreground border-0 shadow-strong">
          {busy ? <RefreshCw className="w-6 h-6 mr-2 animate-spin" /> : <Mic className="w-6 h-6 mr-2" />}
          {busy ? "Analyzing" : "Identify & check budget"}
        </Button>
        <Button onClick={askHelper} disabled={!verdict} size="lg" variant="outline" className="h-20 text-xl">
          <HelpingHand className="w-6 h-6 mr-2" /> Ask my helper
        </Button>
      </div>

      {verdict && (
        <Card className="mt-6 p-6 shadow-soft" aria-live="polite">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-2xl font-bold">{verdict.product.name}</h2>
              {verdict.product.brand && <p className="text-muted-foreground">{verdict.product.brand}</p>}
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold">{verdict.product.currency} {verdict.product.price.toFixed(2)}</div>
              <div className="text-sm text-muted-foreground">typical {verdict.kg.typical_price.toFixed(2)}</div>
            </div>
          </div>

          <div className={`rounded-xl p-4 flex items-start gap-3 ${
            verdict.budget.would_exceed ? "bg-destructive/10 text-destructive" :
            verdict.kg.verdict === "good_deal" ? "bg-success/10 text-success" :
            verdict.kg.verdict === "expensive" ? "bg-warning/10 text-warning" :
            "bg-accent text-accent-foreground"
          }`}>
            {verdict.budget.would_exceed ? <AlertTriangle className="w-6 h-6 shrink-0" /> : <CheckCircle2 className="w-6 h-6 shrink-0" />}
            <p className="text-base font-medium">{verdict.speak}</p>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <Stat label="Spent" value={`${verdict.budget.currency} ${verdict.budget.spent.toFixed(2)}`} />
            <Stat label="Limit" value={`${verdict.budget.currency} ${verdict.budget.limit.toFixed(2)}`} />
            <Stat label="Remaining" value={`${verdict.budget.currency} ${verdict.budget.remaining.toFixed(2)}`} highlight />
          </div>

          <div className="mt-3 text-xs text-muted-foreground">
            Source: {verdict.product.source}  confidence {(verdict.product.confidence * 100).toFixed(0)}%
          </div>
        </Card>
      )}
    </section>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`p-3 rounded-xl ${highlight ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}
