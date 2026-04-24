import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Bot, X } from "lucide-react";
import { speak, stopSpeaking } from "@/lib/speech";
import { summariseTransactions, type BunqAccountData } from "@/lib/bunq";
import type { BasketItem } from "./types";

interface VoiceAssistantProps {
  bunqData: BunqAccountData | null;
  basket: BasketItem[];
  onClose: () => void;
}

function answer(q: string, bunqData: BunqAccountData | null, basket: BasketItem[]): string {
  const lower = q.toLowerCase();
  const bal = bunqData ? parseFloat(bunqData.balance.value) : null;
  const total = basket.reduce((s, b) => s + b.product.price * b.qty, 0);
  const count = basket.reduce((s, b) => s + b.qty, 0);

  if (lower.includes("balance") || lower.includes("how much") || lower.includes("account")) {
    return bal != null ? `Your balance is ${bal.toFixed(2)} euros.` : "Balance not available.";
  }
  if (lower.includes("spent") || lower.includes("spend") || lower.includes("transaction") || lower.includes("history")) {
    return bunqData ? summariseTransactions(bunqData.transactions) : "No transaction data.";
  }
  if (lower.includes("last") || lower.includes("recent")) {
    const t = bunqData?.transactions[0];
    return t ? `Last transaction: ${t.description}, ${Math.abs(parseFloat(t.amount)).toFixed(2)} euros on ${t.date}.` : "No transactions found.";
  }
  if (lower.includes("basket") || lower.includes("cart")) {
    if (!count) return "Your basket is empty.";
    return `Basket: ${count} items, total ${total.toFixed(2)} euros. ${basket.map(b => `${b.qty}x ${b.product.name}`).join(", ")}.`;
  }
  if (lower.includes("afford") || lower.includes("enough")) {
    if (bal == null) return `Basket total is ${total.toFixed(2)} euros.`;
    return `Basket is ${total.toFixed(2)} euros. Balance is ${bal.toFixed(2)} euros. You ${bal >= total ? "can" : "cannot"} afford it.`;
  }
  if (lower.includes("groceries") || lower.includes("supermarket")) {
    if (!bunqData) return "No data.";
    const g = bunqData.transactions.filter(t => t.type === "debit" && /albert|lidl|jumbo|aldi|marqt/i.test(t.description));
    const gt = g.reduce((s, t) => s + Math.abs(parseFloat(t.amount)), 0);
    return `Spent ${gt.toFixed(2)} euros on groceries across ${g.length} transactions.`;
  }
  return `I heard: "${q}". Ask about balance, transactions, basket, or affordability.`;
}

export default function VoiceAssistant({ bunqData, basket, onClose }: VoiceAssistantProps) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const recRef = useRef<any>(null);

  useEffect(() => {
    const msg = bunqData
      ? `Hi! Your balance is ${parseFloat(bunqData.balance.value).toFixed(2)} euros. Ask me anything.`
      : "Hi! Ask me about your basket or account.";
    setResponse(msg);
    setSpeaking(true);
    speak(msg).then(() => setSpeaking(false));
    return () => { stopSpeaking(); };
  }, []);

  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { speak("Speech recognition not supported."); return; }
    stopSpeaking();
    const rec = new SR();
    rec.continuous = false; rec.interimResults = false; rec.lang = "en-US";
    rec.onresult = (e: any) => {
      const text: string = e.results[0][0].transcript;
      setTranscript(text);
      const a = answer(text, bunqData, basket);
      setResponse(a);
      setSpeaking(true);
      speak(a).then(() => setSpeaking(false));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [bunqData, basket]);

  const stopListening = useCallback(() => { recRef.current?.stop(); setListening(false); }, []);

  return (
    <div className="va">
      <div className="va__header">
        <div className="va__title">
          <Bot size={20} /><span>AI Assistant</span>
          {bunqData && <span className="va__source">{bunqData.source === "live" ? "🟢 Live" : "🟡 Demo"}</span>}
        </div>
        <button className="va__close" onClick={onClose} aria-label="Close"><X size={20} /></button>
      </div>

      {bunqData && (
        <div className="va__balance">
          <span>Balance</span>
          <strong>€{parseFloat(bunqData.balance.value).toFixed(2)}</strong>
        </div>
      )}

      <div className={`va__bubble ${speaking ? "va__bubble--speaking" : ""}`} aria-live="polite">
        {transcript && <p className="va__you">You: {transcript}</p>}
        <p>{response}</p>
      </div>

      {bunqData && (
        <ul className="va__txlist">
          {bunqData.transactions.slice(0, 5).map((tx) => (
            <li key={tx.id} className="va__tx">
              <span>{tx.description}</span>
              <span className={tx.type === "debit" ? "va__tx--debit" : "va__tx--credit"}>
                {tx.type === "debit" ? "-" : "+"}€{Math.abs(parseFloat(tx.amount)).toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <button
        className={`va__mic ${listening ? "va__mic--active" : ""}`}
        onMouseDown={startListening} onMouseUp={stopListening}
        onTouchStart={startListening} onTouchEnd={stopListening}
        aria-label={listening ? "Listening" : "Hold to ask"}
      >
        {listening ? <Mic size={28} /> : <MicOff size={28} />}
        <span>{listening ? "Listening…" : "Hold to ask"}</span>
      </button>

      <p className="va__hint">Try: "What's my balance?" · "What did I spend?" · "Can I afford this?"</p>
    </div>
  );
}
