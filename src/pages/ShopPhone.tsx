import { useEffect, useRef, useState, useCallback } from "react";
import { ShoppingCart, Package, ScanBarcode, Check } from "lucide-react";
import { speak, stopSpeaking } from "@/lib/speech";
import { bunq } from "@/lib/bunq";
import { classifyVoiceIntent } from "@/lib/rag-buckets";
import { toast } from "sonner";

/*
  â•"â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
  â•'  SHOPPER BUDDY â€" Flow (from whiteboard)                     â•'
  â•'                                                             â•'
  â•'  1. Scan  â†'  TTS: product description                       â•'
  â•'  2. "Add to basket?"                                        â•'
  â•'       Single tap  = YES  â†'  "How many?"                     â•'
  â•'       Double tap  = NO   â†'  skip, back to scan              â•'
  â•'  3. Tap N times   = quantity  (TTS speaks each number)      â•'
  â•'     2.5 s silence = auto-add                                â•'
  â•'     Hold          = add immediately                         â•'
  â•'  4. Back to scan                                            â•'
  â•'                                                             â•'
  â•'  Setup  (first launch):                                     â•'
  â•'    Single tap = button mode                                 â•'
  â•'    Hold       = voice mode                                  â•'
  â•'                                                             â•'
  â•'  "Explain only available functions"                         â•'
  â•'  â†' TTS only announces what the button can do RIGHT NOW      â•'
  â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
*/

// â"€â"€ TYPES â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

type AppState =
    | "setup"     // choosing mode
    | "idle"      // ready to scan
    | "scanning"  // camera active, waiting for product
    | "scanned"   // product found, awaiting yes/no
    | "quantity"  // counting how many to add
    | "added"     // confirmation flash
    | "checkout"  // showing total, ready to pay
    | "paying";   // processing bunq payment

type InputMode = "button" | "voice" | null;

interface Product {
    name: string;
    brand: string;
    price: number;
    currency: string;
    tts: string;
}

interface BasketItem {
    product: Product;
    qty: number;
}

// â"€â"€ DEMO PRODUCTS â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// € is the Unicode escape for € — immune to file-encoding issues
const fmtPrice = (euros: number) => `€${euros.toFixed(2)}`;

const DEMO_PRODUCTS: Product[] = [
    { name: "Whole Milk 1L",      brand: "Albert Heijn",  price: 1.29, currency: "EUR", tts: "Whole milk, one litre, Albert Heijn, one euro twenty-nine cents." },
    { name: "Sliced Bread",       brand: "Bolletje",      price: 2.49, currency: "EUR", tts: "Sliced wholemeal bread, Bolletje, two euros forty-nine cents." },
    { name: "Free-Range Eggs 10x",brand: "Jumbo",         price: 3.19, currency: "EUR", tts: "Ten free-range eggs, Jumbo, three euros nineteen cents." },
    { name: "Bananas 1kg",        brand: "Chiquita",      price: 1.79, currency: "EUR", tts: "One kilogram of Chiquita bananas, one euro seventy-nine cents." },
    { name: "Gouda Cheese 400g",  brand: "Beemster",      price: 4.99, currency: "EUR", tts: "Beemster Gouda cheese, four hundred grams, four euros ninety-nine cents." },
    { name: "Orange Juice 1.5L",  brand: "Appelsientje",  price: 2.89, currency: "EUR", tts: "Appelsientje orange juice, one and a half litres, two euros eighty-nine cents." },
];

function randomProduct(): Product {
    return DEMO_PRODUCTS[Math.floor(Math.random() * DEMO_PRODUCTS.length)];
}

const SPOKEN_NUMBERS: Record<string, number> = {
    "zero":0,"one":1,"two":2,"three":3,"four":4,"five":5,
    "six":6,"seven":7,"eight":8,"nine":9,"ten":10,
    "eleven":11,"twelve":12,"thirteen":13,"fourteen":14,"fifteen":15,
    "sixteen":16,"seventeen":17,"eighteen":18,"nineteen":19,"twenty":20,
};

function parseSpokenNumber(text: string): number | null {
    // Extract any digit sequence from anywhere in the phrase ("I want 4 pieces" -> 4)
    const m = text.match(/\b(\d+)\b/);
    if (m) { const n = parseInt(m[1]); if (n > 0) return n; }
    for (const [word, val] of Object.entries(SPOKEN_NUMBERS)) {
        if (text.includes(word)) return val;
    }
    return null;
}

// â"€â"€ SPEECH RECOGNITION HOOK â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

interface SpeechRecognitionInstance {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult:     ((e: any) => void) | null;
    onerror:      ((e: any) => void) | null;
    onend:        (() => void) | null;
    onstart:      (() => void) | null;
    onaudiostart: (() => void) | null;
    onsoundstart: (() => void) | null;
    onspeechstart:(() => void) | null;
    onspeechend:  (() => void) | null;
    onaudioend:   (() => void) | null;
    start: () => void;
    stop:  () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;
type WindowWithSR = Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

function useSpeechRecognition() {
    const [listening, setListening] = useState(false);
    const [transcript, setTranscript] = useState("");
    const recRef = useRef<SpeechRecognitionInstance | null>(null);
    const networkRetryRef = useRef(0);
    // True when user explicitly stopped; prevents retries after button release
    const stoppedRef = useRef(false);
    // True from onspeechstart to onend; prevents aborting mid-upload (network error)
    const speechStartedRef = useRef(false);
    // Mirrors `listening` synchronously so callbacks can read it without stale closures
    const listeningRef = useRef(false);

    function setListeningSync(val: boolean) {
        listeningRef.current = val;
        setListening(val);
    }

    const startListening = useCallback(() => {
        if (listeningRef.current) {
            console.log("[SR] startListening: session already active, skipping");
            return;
        }
        console.log("[SR] startListening called");
        stoppedRef.current = false;
        speechStartedRef.current = false;
        networkRetryRef.current = 0;

        const w = window as WindowWithSR;
        const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
        if (!SR) {
            console.error("[SR] ❌ SpeechRecognition API not available in this browser (try Chrome)");
            toast.error("Speech recognition not supported — try Chrome");
            return;
        }
        console.log("[SR] API available, creating instance...");

        if (recRef.current) {
            try { recRef.current.stop(); } catch (_) { /* ignore */ }
        }

        function createAndStart() {
            if (stoppedRef.current) {
                console.log("[SR] createAndStart skipped -- stopped");
                return;
            }
            if (listeningRef.current) {
                console.log("[SR] createAndStart skipped -- session active");
                return;
            }
            const rec = new SR!();
            rec.continuous = false;
            rec.interimResults = false;
            rec.lang = "en-US";

            rec.onresult = (e: any) => {
                const text = e.results[0][0].transcript;
                const conf = e.results[0][0].confidence;
                networkRetryRef.current = 0;
                console.log(`[SR] ✅ onresult: "${text}" (confidence: ${conf != null ? conf.toFixed(2) : "n/a"})`);
                setTranscript(text);
            };

            rec.onerror = (e: any) => {
                const code: string = e?.error ?? "unknown";
                const hints: Record<string, string> = {
                    "not-allowed":        "Microphone permission denied — allow mic in browser settings",
                    "service-not-allowed":"Service blocked — use localhost or HTTPS",
                    "audio-capture":      "No microphone found or already in use",
                    "no-speech":          "No speech detected (silence timeout)",
                    "network":            "Network error communicating with speech service",
                    "aborted":            "Recognition aborted (normal if stopListening was called)",
                };
                console.warn(`[SR] ⚠️ onerror: ${code} — ${hints[code] ?? "no hint available"}`);

                if (code === "network" && !stoppedRef.current) {
                    const attempt = ++networkRetryRef.current;
                    if (attempt <= 3) {
                        const delay = attempt * 1500;
                        console.log(`[SR] network error -- retry ${attempt}/3 in ${delay}ms`);
                        setListeningSync(false);
                        setTimeout(createAndStart, delay);
                        return;
                    }
                    console.error("[SR] network error after 3 retries, giving up");
                    toast.error("Speech service unavailable -- check internet connection");
                    networkRetryRef.current = 0;
                } else if (code !== "aborted" && code !== "no-speech") {
                    toast.warning(`Mic error: ${code}`);
                }
                setListeningSync(false);
            };

            rec.onstart      = () => console.log("[SR] onstart: recognition started, waiting for speech...");
            rec.onaudiostart = () => console.log("[SR] onaudiostart: microphone opened");
            rec.onsoundstart = () => console.log("[SR] onsoundstart: sound detected");
            rec.onspeechstart= () => { speechStartedRef.current = true;  console.log("[SR] onspeechstart: speech detected"); };
            rec.onspeechend  = () => console.log("[SR] onspeechend: speech stopped, processing...");
            rec.onaudioend   = () => console.log("[SR] onaudioend: microphone closed");
            rec.onend        = () => { speechStartedRef.current = false; setListeningSync(false); console.log("[SR] onend: session ended"); };

            recRef.current = rec;
            try {
                rec.start();
                setListeningSync(true);
                console.log("[SR] rec.start() called");
            } catch (err) {
                console.error("[SR] rec.start() threw:", err);
                setListeningSync(false);
            }
        }

        createAndStart();
    }, []);

    const stopListening = useCallback(() => {
        stoppedRef.current = true;
        networkRetryRef.current = 0;
        if (!speechStartedRef.current) {
            console.log("[SR] stopListening: aborting (no speech in flight)");
            try { recRef.current?.stop(); } catch (_) { /* ignore */ }
            setListeningSync(false);
        } else {
            console.log("[SR] stopListening: speech in flight, letting recognition complete");
        }
    }, []);

    return { listening, listeningRef, transcript, startListening, stopListening, setTranscript };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â"€â"€ MAIN COMPONENT â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

export default function ShopPhone() {
    const videoRef = useRef<HTMLVideoElement>(null);

    const [appState, setAppState] = useState<AppState>("setup");
    const [inputMode, setInputMode] = useState<InputMode>(null);
    const [product, setProduct] = useState<Product | null>(null);
    const [basket, setBasket] = useState<BasketItem[]>([]);
    const [cameraOn, setCameraOn] = useState(false);
    const [isHolding, setIsHolding] = useState(false);

    // Quantity counter (only used in "quantity" state)
    const [qty, setQty] = useState(0);
    const qtyRef = useRef(0);
    const qtyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const QTY_CONFIRM_MS = 2500; // auto-add after 2.5 s of silence

    // Double-tap detection (for "no/skip" in "scanned" state)
    const doubleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const DOUBLE_TAP_MS = 400; // window to detect double-tap

    // Hold-press detection
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const holdFiredRef = useRef(false);
    const HOLD_MS = 500;

    const { listening, listeningRef, transcript, startListening, stopListening, setTranscript } =
        useSpeechRecognition();

    // Stable refs â€" read these inside timer callbacks to avoid stale closures
    const appStateRef = useRef(appState);
    const inputModeRef = useRef(inputMode);
    const basketRef = useRef(basket);
    const productRef = useRef(product);
    useEffect(() => { appStateRef.current = appState;   console.log(`[State] appState → ${appState}`); }, [appState]);
    useEffect(() => { inputModeRef.current = inputMode; console.log(`[State] inputMode → ${inputMode}`); }, [inputMode]);
    useEffect(() => { basketRef.current = basket; }, [basket]);
    useEffect(() => { productRef.current = product; }, [product]);

    // Speak welcome on first mount — mode is chosen by button gesture, not voice
    useEffect(() => {
        const t = setTimeout(() => {
            console.log("[Init] speaking welcome prompt");
            speak("Welcome to Shopper Buddy. Press the button once for button mode: tap to scan and navigate. Or hold the button for voice mode: hold and speak your commands.");
        }, 700);
        return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // â"€â"€ Cleanup â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    useEffect(() => () => { stopSpeaking(); }, []);

    // â"€â"€ Camera â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    async function startCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment" },
            });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
            setCameraOn(true);
        } catch {
            toast.message("Camera unavailable - using demo mode");
            setCameraOn(true);
        }
    }

    function stopCamera() {
        const s = videoRef.current?.srcObject as MediaStream | null;
        s?.getTracks().forEach((t) => t.stop());
        setCameraOn(false);
    }

    useEffect(() => () => { stopSpeaking(); stopCamera(); }, []);

    // â"€â"€ Step handlers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

    /** STEP 1: Scan product (press button once) */
    async function handleScan() {
        if (!cameraOn) {
            await startCamera();
        }
        setAppState("scanning");
        speak("Scanning product. Please hold steady.");

        // Wait a brief moment to let the camera adjust
        await new Promise((r) => setTimeout(r, 1000));

        let base64Image = "";
        if (videoRef.current && canvasRef.current) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                base64Image = canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
            }
        }

        if (!base64Image) {
            toast.error("Failed to capture image");
            speak("Failed to capture image. Using demo product.");
            const scanned = randomProduct();
            setProduct(scanned);
            setAppState("scanned");
            speak(scanned.tts + " Would you like to add this to your basket?");
            return;
        }

        try {
            const response = await fetch("/api/rag", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ imageBase64: base64Image })
            });

            if (!response.ok) {
                throw new Error("RAG API Error: " + response.status);
            }

            const data = await response.json();
            
            if (!data.success || !data.match || !data.match.product) {
                throw new Error(data.error || "No match found from RAG pipeline");
            }

            // Convert backend product schema to the frontend schema
            const p = data.match.product;
            const scanned: Product = {
                name: p.name,
                brand: p.brand || 'Unknown',
                price: parseFloat(p.price) || 0,
                currency: "€",
                tts: `I found ${p.name}. The price is ${p.price} euros. ${data.match.reasoning}`
            };

            setProduct(scanned);
            setAppState("scanned");

            // Speak the product description
            speak(scanned.tts + " Would you like to add this to your basket?");
        } catch (e) {
            console.error("Scan error:", e);
            speak("Sorry, I had trouble analyzing the image. Using demo product.");
            const scanned = randomProduct();
            setProduct(scanned);
            setAppState("scanned");
            speak(scanned.tts + " Would you like to add this to your basket?");
        }
        setCameraOn(true); // demo mode
    }

    // REMOVED PREMATURE CLOSING BRACE HERE


    // â"€â"€ Read basket aloud â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    function readBasket() {
        const b = basketRef.current;
        if (b.length === 0) {
            speak("Your basket is empty. Scan a product to get started.");
            return;
        }
        const total = b.reduce((s, i) => s + i.product.price * i.qty, 0);
        const itemCount = b.reduce((s, i) => s + i.qty, 0);
        const itemNames = b.map(i => `${i.qty} ${i.product.name}`).join(", ");
        speak(`You have ${itemCount} item${itemCount !== 1 ? "s" : ""}: ${itemNames}. Total is ${total.toFixed(2)} euros. Shall I proceed to checkout?`);
        setAppState("checkout");
    }

    function doRemoveFromBasket(hint?: string) {
        const b = basketRef.current;
        if (b.length === 0) { speak("Your basket is already empty."); return; }
        if (hint && hint.trim().length > 1) {
            const h = hint.toLowerCase();
            const item = b.find(i =>
                i.product.name.toLowerCase().split(" ").some(w => w.length > 2 && h.includes(w))
            );
            if (item) {
                setBasket(prev => item.qty > 1
                    ? prev.map(i => i.product.name === item.product.name ? { ...i, qty: i.qty - 1 } : i)
                    : prev.filter(i => i.product.name !== item.product.name)
                );
                speak(`Removed one ${item.product.name}.`);
            } else {
                speak("I could not find that item in your basket.");
            }
        } else {
            const last = b[b.length - 1];
            setBasket(prev => last.qty > 1
                ? prev.map(i => i.product.name === last.product.name ? { ...i, qty: i.qty - 1 } : i)
                : prev.slice(0, -1)
            );
            speak(`Removed ${last.product.name}.`);
        }
    }

    // â"€â"€ Bunq Payment â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    async function doPayment() {
        const total = basketRef.current.reduce((s, i) => s + i.product.price * i.qty, 0);
        if (total === 0) {
            speak("Your basket is empty.");
            setAppState("idle");
            return;
        }

        setAppState("paying");
        speak(`Initiating bunq payment for ${total.toFixed(2)} euros. Please wait.`);

        const result = await bunq.processPayment({
            amount: total,
            description: "Shopper Buddy Grocery Trip",
            counterparty: "Supermarket AH"
        });

        if (result.success) {
            speak("Payment successful. Thank you for shopping with Shopper Buddy.");
            setBasket([]);
            setAppState("added");
            setTimeout(() => setAppState("idle"), 3000);
        } else {
            speak("Payment failed. " + result.message);
            setAppState("checkout");
        }
    }

    // â"€â"€ Scan â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    async function doScan() {
        await handleScan();
    }

    // â"€â"€ Skip product (double-tap in scanned state) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    function doSkip() {
        if (qtyTimerRef.current) { clearTimeout(qtyTimerRef.current); qtyTimerRef.current = null; }
        if (doubleTapTimerRef.current) { clearTimeout(doubleTapTimerRef.current); doubleTapTimerRef.current = null; }
        qtyRef.current = 0;
        setQty(0);
        setAppState("idle");
        setProduct(null);
        speak("Skipped.");
    }

    // â"€â"€ Accept product (single-tap in scanned state) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    function doAccept() {
        setAppState("quantity");
        qtyRef.current = 0;
        setQty(0);
        const prompt = inputModeRef.current === "voice"
            ? "How many? Just say the number."
            : "How many? Tap to count, then hold to confirm.";
        speak(prompt);
    }

    // â"€â"€ Commit qty items to basket â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    function doAddToBasket(count: number) {
        const p = productRef.current;
        if (!p || count < 1) return;

        if (qtyTimerRef.current) { clearTimeout(qtyTimerRef.current); qtyTimerRef.current = null; }

        setBasket(prev => {
            const existing = prev.find(b => b.product.name === p.name);
            if (existing) {
                return prev.map(b =>
                    b.product.name === p.name ? { ...b, qty: b.qty + count } : b
                );
            }
            return [...prev, { product: p, qty: count }];
        });

        qtyRef.current = 0;
        setQty(0);
        setAppState("added");
        speak(`${count} ${p.name} added.`);

        setTimeout(() => {
            setAppState("idle");
            setProduct(null);
        }, 2000);
    }

    // â"€â"€ Increment tap counter (quantity state) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    function incrementQty() {
        const next = qtyRef.current + 1;
        qtyRef.current = next;
        setQty(next);
        speak(String(next)); // TTS: "One", "Two", "Three"â€¦

        // Reset auto-confirm countdown on every tap
        if (qtyTimerRef.current) clearTimeout(qtyTimerRef.current);
        qtyTimerRef.current = setTimeout(() => {
            doAddToBasket(qtyRef.current);
        }, QTY_CONFIRM_MS);
    }

    // â"€â"€ SHORT PRESS handler (context-aware) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    function handleShortPress() {
        const state = appStateRef.current;
        const mode = inputModeRef.current;
        console.log(`[Button] shortPress | state: ${state} | mode: ${mode}`);

        // â"€â"€ Setup: choose button mode â"€â"€
        if (state === "setup") {
            setInputMode("button");
            setAppState("idle");
            speak("Button mode selected. Tap once to scan a product. Double-tap to skip. Tap to count quantity, then hold to confirm. Hold anytime to hear your basket.");
            return;
        }

        if (state === "added" || state === "scanning") return; // busy, ignore

        if (mode === "button") {
            if (state === "idle") {
                doScan();

            } else if (state === "scanned") {
                // Double-tap detection:
                // If a tap already happened within the window â†' double-tap = skip
                if (doubleTapTimerRef.current) {
                    clearTimeout(doubleTapTimerRef.current);
                    doubleTapTimerRef.current = null;
                    doSkip();
                } else {
                    // First tap â€" wait to see if a second arrives
                    doubleTapTimerRef.current = setTimeout(() => {
                        doubleTapTimerRef.current = null;
                        doAccept(); // single-tap confirmed â†' go to quantity
                    }, DOUBLE_TAP_MS);
                }

            } else if (state === "quantity") {
                incrementQty();
            } else if (state === "checkout") {
                doPayment();
            }

        } else if (mode === "voice") {
            if (state === "quantity") {
                incrementQty();
            } else if (!listeningRef.current) {
                startListening();
            }
        }
    }

    // â"€â"€ HOLD handler (context-aware) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    function handleHoldFire() {
        const state = appStateRef.current;
        const mode = inputModeRef.current;
        console.log(`[Button] holdFire | state: ${state} | mode: ${mode}`);

        // â"€â"€ Setup: choose voice mode â"€â"€
        if (state === "setup") {
            setInputMode("voice");
            setAppState("idle");
            speak("Voice mode selected. Hold the button, speak your command, then release. Say things like: scan, basket, checkout, or remove last item.");
            return;
        }

        if (mode === "button") {
            if (state === "quantity") {
                // Hold during quantity = confirm immediately
                if (qtyRef.current > 0) {
                    doAddToBasket(qtyRef.current);
                } else {
                    // Nothing counted yet â†' cancel
                    if (qtyTimerRef.current) { clearTimeout(qtyTimerRef.current); qtyTimerRef.current = null; }
                    setAppState("idle");
                    setProduct(null);
                    speak("Cancelled.");
                }
            } else if (state === "scanned") {
                // Cancel pending single-tap (they changed their mind and held instead)
                if (doubleTapTimerRef.current) { clearTimeout(doubleTapTimerRef.current); doubleTapTimerRef.current = null; }
                readBasket();
            } else {
                // idle, added, etc. â†' read basket
                readBasket();
            }
        } else if (mode === "voice") {
            if (state === "scanning" || state === "paying" || state === "added") return;
            setIsHolding(true);
            startListening();
        }
    }

    // â"€â"€ Hold release â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    function handleHoldRelease() {
        if (inputModeRef.current === "voice") {
            setIsHolding(false);
            stopListening();
        }
    }

    // â"€â"€ Pointer events â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    function onPointerDown(e: React.PointerEvent) {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        holdFiredRef.current = false;
        holdTimerRef.current = setTimeout(() => {
            holdFiredRef.current = true;
            handleHoldFire();
        }, HOLD_MS);
    }

    function onPointerUp() {
        if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
        if (!holdFiredRef.current) {
            handleShortPress();
        } else {
            handleHoldRelease();
        }
        holdFiredRef.current = false;
    }

    function onPointerCancel() {
        if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
        if (holdFiredRef.current) handleHoldRelease();
        holdFiredRef.current = false;
    }

    // â"€â"€ Voice transcript processing â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    useEffect(() => {
        if (!transcript) return;
        const lower = transcript.toLowerCase().trim();
        const state = appStateRef.current;
        console.log(`[Transcript] "${transcript}" | state: ${state}`);
        setTranscript("");

        if (import.meta.env.DEV) {
            const { topLabel, topScore, runnerUpId, runnerUpScore } = classifyVoiceIntent(lower);
            toast(`"${transcript}"`, {
                description: `${topLabel} (${topScore.toFixed(2)}) / ${runnerUpId} (${runnerUpScore.toFixed(2)})`,
                duration: 3000,
            });
        }

        // Button-only states — ignore voice
        if (state === "setup" || state === "scanning" || state === "paying") return;

        // ── Universal commands (work in any active state) ──────────────────

        // Basket comparison: "is there more than 20 euros in my basket?"
        const euroMatch = lower.match(/\b(\d+(?:[.,]\d+)?)\s*(?:euro|euros|eur)/);
        if (euroMatch) {
            const amount = parseFloat(euroMatch[1].replace(",", "."));
            const total = basketRef.current.reduce((s, i) => s + i.product.price * i.qty, 0);
            if (lower.includes("more than") || lower.includes("over") || lower.includes("above") || lower.includes("exceed")) {
                speak(total > amount
                    ? `Yes, your basket is ${total.toFixed(2)} euros, which is more than ${amount} euros.`
                    : `No, your basket is only ${total.toFixed(2)} euros, which is less than ${amount} euros.`);
                return;
            }
            if (lower.includes("less than") || lower.includes("under") || lower.includes("below")) {
                speak(total < amount
                    ? `Yes, your basket is ${total.toFixed(2)} euros, which is less than ${amount} euros.`
                    : `No, your basket is ${total.toFixed(2)} euros, which is more than ${amount} euros.`);
                return;
            }
        }

        // Remove / undo
        if (lower.includes("remove") || lower.includes("delete") || lower.includes("take out") ||
            lower.includes("undo") || lower.includes("take back")) {
            const isLast = lower.includes("last") || lower.includes("latest") ||
                           lower.includes("that") || lower.includes("undo");
            const hint = isLast ? undefined
                : lower.replace(/\b(remove|delete|take out|take back|the|a|an|from (?:my )?(?:basket|cart))\b/g, "").trim() || undefined;
            doRemoveFromBasket(hint);
            return;
        }

        // Basket / total questions
        if ((lower.includes("basket") || lower.includes("cart") || lower.includes("total") ||
             lower.includes("how much") || lower.includes("what have i") || lower.includes("what do i have")) &&
            state !== "scanned" && state !== "quantity") {
            readBasket();
            return;
        }

        // ── State-specific handlers ────────────────────────────────────────

        if (state === "scanned") {
            const num = parseSpokenNumber(lower);
            if (num !== null) {
                // "I want 4" / "three please" -> add that quantity immediately, no follow-up
                doAddToBasket(num);
            } else if (lower.includes("yes") || lower.includes("add") || lower.includes("yeah") ||
                       lower.includes("sure") || lower.includes("ok") || lower.includes("please") ||
                       lower.includes("want") || lower.includes("take it")) {
                doAccept(); // affirmative without a number -> ask how many
            } else if (lower.includes("no") || lower.includes("skip") || lower.includes("nope") ||
                       lower.includes("next") || lower.includes("pass") || lower.includes("cancel") ||
                       lower.includes("don't") || lower.includes("dont")) {
                doSkip();
            }

        } else if (state === "quantity") {
            const num = parseSpokenNumber(lower);
            if (num !== null && num > 0) {
                doAddToBasket(num);
            } else if (lower.includes("done") || lower.includes("confirm") || lower.includes("yes") ||
                       lower.includes("add") || lower.includes("that") || lower.includes("ok")) {
                doAddToBasket(Math.max(1, qtyRef.current));
            } else if (lower.includes("cancel") || lower.includes("no") || lower.includes("skip") ||
                       lower.includes("back") || lower.includes("never mind") || lower.includes("nevermind")) {
                if (qtyTimerRef.current) { clearTimeout(qtyTimerRef.current); qtyTimerRef.current = null; }
                qtyRef.current = 0;
                setQty(0);
                setAppState("idle");
                setProduct(null);
                speak("Cancelled.");
            }

        } else if (state === "idle" || state === "added") {
            if (lower.includes("scan") || lower.includes("product") || lower.includes("item") ||
                lower.includes("add") || lower.includes("price")) {
                doScan();
            } else if (lower.includes("checkout") || lower.includes("pay") ||
                       lower.includes("done shopping") || lower.includes("finish")) {
                readBasket(); // read basket first so user hears total before confirming
            }

        } else if (state === "checkout") {
            if (lower.includes("yes") || lower.includes("pay") || lower.includes("confirm") ||
                lower.includes("proceed") || lower.includes("sure") || lower.includes("ok")) {
                doPayment();
            } else if (lower.includes("no") || lower.includes("cancel") || lower.includes("back") ||
                       lower.includes("wait") || lower.includes("not yet")) {
                setAppState("idle");
                speak("OK, back to shopping.");
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transcript]);

    // â"€â"€ Derived values â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    const basketTotal = basket.reduce((s, b) => s + b.product.price * b.qty, 0);
    const basketCount = basket.reduce((s, b) => s + b.qty, 0);

    // Button colour reflects current state
    const btnClass = [
        "shop-phone__main-btn",
        appState === "added" ? "shop-phone__main-btn--success" :
            (isHolding || listening) ? "shop-phone__main-btn--listening" :
                appState === "scanning" ? "shop-phone__main-btn--scanning" :
                    appState === "quantity" ? "shop-phone__main-btn--quantity" :
                        (appState === "checkout" || appState === "paying") ? "shop-phone__main-btn--success" :
                            "shop-phone__main-btn--idle",
    ].join(" ");

    // â"€â"€ Render â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    return (
        <div className="shop-phone">

            {/* â•â• TOP 70%: camera + minimal info â•â• */}
            <div className="shop-phone__top">

                <video ref={videoRef} className="shop-phone__video" playsInline muted />
                <canvas ref={canvasRef} style={{ display: "none" }} />

                {/* Header */}
                <div className="shop-phone__header">
                    <div className="shop-phone__logo">
                        <div className="shop-phone__logo-icon"><Package size={18} /></div>
                        <span className="shop-phone__logo-name">Shopper Buddy</span>
                    </div>
                    {basketCount > 0 && (
                        <div className="shop-phone__basket-pill" aria-label={`${basketCount} items`}>
                            <ShoppingCart size={16} />
                            <span>{basketCount}</span>
                            <span className="shop-phone__basket-total-pill">{fmtPrice(basketTotal)}</span>
                        </div>
                    )}
                </div>

                {/* Setup: logo glow */}
                {appState === "setup" && (
                    <div className="shop-phone__overlay">
                        <div className="shop-phone__setup-icon">
                            <Package size={64} strokeWidth={1.2} />
                        </div>
                    </div>
                )}

                {/* Scanning */}
                {appState === "scanning" && (
                    <div className="shop-phone__overlay shop-phone__overlay--scanning">
                        <ScanBarcode size={72} className="scan-anim" />
                    </div>
                )}

                {/* Product info â€" shown while scanned / counting / added */}
                {(appState === "scanned" || appState === "quantity" || appState === "added") && product && (
                    <div className={`shop-phone__product-overlay ${appState === "added" ? "shop-phone__product-overlay--added" :
                        appState === "quantity" ? "shop-phone__product-overlay--quantity" :
                            ""
                        }`}>
                        {appState === "added" && (
                            <div className="shop-phone__check-circle">
                                <Check size={36} strokeWidth={3} />
                            </div>
                        )}
                        {appState === "quantity" && (
                            <div className="shop-phone__qty-counter" aria-live="polite" key={qty}>
                                {qty === 0 ? "?" : qty}
                            </div>
                        )}
                        <div className="shop-phone__product-name">{product.name}</div>
                        <div className="shop-phone__product-brand">{product.brand}</div>
                        <div className="shop-phone__product-price">
                            {fmtPrice(product.price)}
                        </div>
                    </div>
                )}

                {/* Scan frame corners */}
                {cameraOn && (appState === "idle" || appState === "scanning") && (
                    <div className="shop-phone__scan-frame">
                        <span className="corner tl" />
                        <span className="corner tr" />
                        <span className="corner bl" />
                        <span className="corner br" />
                    </div>
                )}

                {/* Listening dots */}
                {listening && (
                    <div className="shop-phone__listening-bar" aria-live="polite">
                        <div className="shop-phone__listening-dot" />
                        <div className="shop-phone__listening-dot" />
                        <div className="shop-phone__listening-dot" />
                    </div>
                )}
            </div>

            {/* â•â• BOTTOM 30%: THE one big button â•â• */}
            <div className="shop-phone__action-bar">
                <button
                    id="main-btn"
                    className={btnClass}
                    onPointerDown={onPointerDown}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerCancel}
                    onPointerLeave={onPointerCancel}
                    aria-label="Main action button"
                    style={{ touchAction: "none" }}
                >
                    <span className="shop-phone__main-btn-glow" />
                </button>
            </div>
        </div>
    );
}
