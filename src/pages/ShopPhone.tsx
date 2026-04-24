import { useEffect, useRef, useState, useCallback } from "react";
import { scanAndMatch } from "@/lib/rag";
import { evaluateSituation, processVoiceInput } from "@/lib/situationGraph";
import { ShoppingCart, Package, ScanBarcode, Check } from "lucide-react";
import { speak, stopSpeaking } from "@/lib/speech";
import { bunq } from "@/lib/bunq";
import { toast } from "sonner";

/*
  â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
  â•‘  SHOPPER BUDDY â€” Flow (from whiteboard)                     â•‘
  â•‘                                                             â•‘
  â•‘  1. Scan  â†’  TTS: product description                       â•‘
  â•‘  2. "Add to basket?"                                        â•‘
  â•‘       Single tap  = YES  â†’  "How many?"                     â•‘
  â•‘       Double tap  = NO   â†’  skip, back to scan              â•‘
  â•‘  3. Tap N times   = quantity  (TTS speaks each number)      â•‘
  â•‘     2.5 s silence = auto-add                                â•‘
  â•‘     Hold          = add immediately                         â•‘
  â•‘  4. Back to scan                                            â•‘
  â•‘                                                             â•‘
  â•‘  Setup  (first launch):                                     â•‘
  â•‘    Single tap = button mode                                 â•‘
  â•‘    Hold       = voice mode                                  â•‘
  â•‘                                                             â•‘
  â•‘  "Explain only available functions"                         â•‘
  â•‘  â†’ TTS only announces what the button can do RIGHT NOW      â•‘
  â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
*/

// â”€â”€ TYPES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ DEMO PRODUCTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const DEMO_PRODUCTS: Product[] = [
    { name: "Whole Milk 1L", brand: "Albert Heijn", price: 1.29, currency: "â‚¬", tts: "Whole milk, one litre, Albert Heijn, one euro twenty-nine cents." },
    { name: "Sliced Bread", brand: "Bolletje", price: 2.49, currency: "â‚¬", tts: "Sliced wholemeal bread, Bolletje, two euros forty-nine cents." },
    { name: "Free-Range Eggs 10x", brand: "Jumbo", price: 3.19, currency: "â‚¬", tts: "Ten free-range eggs, Jumbo, three euros nineteen cents." },
    { name: "Bananas 1kg", brand: "Chiquita", price: 1.79, currency: "â‚¬", tts: "One kilogram of Chiquita bananas, one euro seventy-nine cents." },
    { name: "Gouda Cheese 400g", brand: "Beemster", price: 4.99, currency: "â‚¬", tts: "Beemster Gouda cheese, four hundred grams, four euros ninety-nine cents." },
    { name: "Orange Juice 1.5L", brand: "Appelsientje", price: 2.89, currency: "â‚¬", tts: "Appelsientje orange juice, one and a half litres, two euros eighty-nine cents." },
];

function randomProduct(): Product {
    return DEMO_PRODUCTS[Math.floor(Math.random() * DEMO_PRODUCTS.length)];
}

// â”€â”€ SPEECH RECOGNITION HOOK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface SpeechRecognitionInstance {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((e: any) => void) | null;
    onerror: (() => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
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

    const startListening = useCallback(() => {
        const w = window as WindowWithSR;
        const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
        if (!SR) {
            toast.error("Speech recognition not supported in this browser");
            return;
        }
        const rec = new SR();
        rec.continuous = false;
        rec.interimResults = false;
        rec.lang = "en-US";
        rec.onresult = (e: any) => {
            setTranscript(e.results[0][0].transcript);
        };
        rec.onerror = () => setListening(false);
        rec.onend = () => setListening(false);
        recRef.current = rec;
        rec.start();
        setListening(true);
    }, []);

    const stopListening = useCallback(() => {
        recRef.current?.stop();
        setListening(false);
    }, []);

    return { listening, transcript, startListening, stopListening, setTranscript };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ MAIN COMPONENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

export default function ShopPhone() {
    const videoRef = useRef<HTMLVideoElement>(null);

    const [appState, setAppState] = useState<AppState>("setup");
    const [inputMode, setInputMode] = useState<InputMode>(null);
    const [product, setProduct] = useState<Product | null>(null);
    const [basket, setBasket] = useState<BasketItem[]>([]);
    const [cameraOn, setCameraOn] = useState(false);
    const [balance, setBalance] = useState<number | null>(null);
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

    const { listening, transcript, startListening, stopListening, setTranscript } =
        useSpeechRecognition();

    // Stable refs â€” read these inside timer callbacks to avoid stale closures
    const appStateRef = useRef(appState);
    const inputModeRef = useRef(inputMode);
    const basketRef = useRef(basket);
    const productRef = useRef(product);
    useEffect(() => { appStateRef.current = appState; }, [appState]);
    useEffect(() => { inputModeRef.current = inputMode; }, [inputMode]);
    useEffect(() => { basketRef.current = basket; }, [basket]);
    useEffect(() => { productRef.current = product; }, [product]);

    // AUTO-LISTEN PATCH: speak welcome then immediately listen for "button"/"voice"
    useEffect(() => {
        let cancelled = false;
        const t = setTimeout(async () => {
            await speak("Welcome to Shopper Buddy. Say button or voice to choose your mode.");
            if (!cancelled) startListening();
        }, 700);
        return () => { cancelled = true; clearTimeout(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);


    // Load BUNQ balance on mount for situation graph
    useEffect(() => {
        bunq.getBalance().then(b => setBalance(parseFloat(b))).catch(() => { });
    }, []);
    // â”€â”€ Cleanup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    useEffect(() => () => { stopSpeaking(); }, []);

    // â”€â”€ Camera â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
            toast.message("Camera unavailable â€” using demo mode");
            setCameraOn(true);
        }
    }

    function stopCamera() {
        const s = videoRef.current?.srcObject as MediaStream | null;
        s?.getTracks().forEach((t) => t.stop());
        setCameraOn(false);
    }

    useEffect(() => () => { stopSpeaking(); stopCamera(); }, []);

    // â”€â”€ Step handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async function handleScan() {
        /** STEP 1: Scan product (press button once) */
        if (!cameraOn) await startCamera();
        setAppState("scanning");
        speak("Scanning product. Please hold steady.");
        await new Promise((r) => setTimeout(r, 1000));

        let base64Image = "";
        if (videoRef.current && canvasRef.current) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            if (ctx) { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); base64Image = canvas.toDataURL("image/jpeg", 0.6).split(",")[1]; }
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


    // â”€â”€ Read basket aloud â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    function readBasket() {
        const b = basketRef.current;
        if (b.length === 0) {
            speak("Your basket is empty.");
            return;
        }
        const total = b.reduce((s, i) => s + i.product.price * i.qty, 0);
        const itemNames = b.map(i => `${i.qty} ${i.product.name}`).join(", ");
        speak(`Your basket: ${itemNames}. Total: ${total.toFixed(2)} euros. Would you like to check out?`);
        setAppState("checkout");
    }

    // â”€â”€ Bunq Payment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€ Scan â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async function doScan() {
        await handleScan();
    }

    // â”€â”€ Skip product (double-tap in scanned state) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    function doSkip() {
        if (qtyTimerRef.current) { clearTimeout(qtyTimerRef.current); qtyTimerRef.current = null; }
        if (doubleTapTimerRef.current) { clearTimeout(doubleTapTimerRef.current); doubleTapTimerRef.current = null; }
        qtyRef.current = 0;
        setQty(0);
        setAppState("idle");
        setProduct(null);
        speak("Skipped.");
    }

    // â”€â”€ Accept product (single-tap in scanned state) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    function doAccept() {
        setAppState("quantity");
        qtyRef.current = 0;
        setQty(0);
        // Only explain what the user can do right now
        speak("How many? Tap to count. Hold to confirm.");
    }

    // â”€â”€ Commit qty items to basket â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€ Increment tap counter (quantity state) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€ SHORT PRESS handler (context-aware) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    function handleShortPress() {
        const state = appStateRef.current;
        const mode = inputModeRef.current;

        // â”€â”€ Setup: choose button mode â”€â”€
        if (state === "setup") {
            setInputMode("button");
            setAppState("idle");
            speak("Button mode. Press to scan. Hold to hear basket.");
            return;
        }

        if (state === "added" || state === "scanning") return; // busy, ignore

        if (mode === "button") {
            if (state === "idle") {
                doScan();

            } else if (state === "scanned") {
                // Double-tap detection:
                // If a tap already happened within the window â†’ double-tap = skip
                if (doubleTapTimerRef.current) {
                    clearTimeout(doubleTapTimerRef.current);
                    doubleTapTimerRef.current = null;
                    doSkip();
                } else {
                    // First tap â€” wait to see if a second arrives
                    doubleTapTimerRef.current = setTimeout(() => {
                        doubleTapTimerRef.current = null;
                        doAccept(); // single-tap confirmed â†’ go to quantity
                    }, DOUBLE_TAP_MS);
                }

            } else if (state === "quantity") {
                incrementQty();
            } else if (state === "checkout") {
                doPayment();
            }

        } else if (mode === "voice") {
            // In voice mode a tap also triggers the mic as a fallback
            startListening();
        }
    }

    // â”€â”€ HOLD handler (context-aware) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    function handleHoldFire() {
        const state = appStateRef.current;
        const mode = inputModeRef.current;

        // â”€â”€ Setup: choose voice mode â”€â”€
        if (state === "setup") {
            setInputMode("voice");
            setAppState("idle");
            speak("Voice mode. Hold and speak. Release when done.");
            return;
        }

        if (mode === "button") {
            if (state === "quantity") {
                // Hold during quantity = confirm immediately
                if (qtyRef.current > 0) {
                    doAddToBasket(qtyRef.current);
                } else {
                    // Nothing counted yet â†’ cancel
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
                // idle, added, etc. â†’ read basket
                readBasket();
            }
        } else if (mode === "voice") {
            setIsHolding(true);
            startListening();
        }
    }

    // â”€â”€ Hold release â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    function handleHoldRelease() {
        if (inputModeRef.current === "voice") {
            setIsHolding(false);
            stopListening();
        }
    }

    // â”€â”€ Pointer events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€ Voice transcript processing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    useEffect(() => {
        if (!transcript) return;
        const state = appStateRef.current;
        const ctx = {
            appState: state,
            inputMode: inputModeRef.current,
            basketTotal: basketRef.current.reduce((s: number, b: any) => s + b.product.price * b.qty, 0),
            basketCount: basketRef.current.reduce((s: number, b: any) => s + b.qty, 0),
            balance,
            productPrice: productRef.current ? Number(productRef.current.price) : null,
            productName: productRef.current?.name ?? null,
            allergens: [],
            isPublicPlace: inputModeRef.current === "button",
        };
        const result = processVoiceInput(transcript, ctx);
        switch (result.action) {
            case "set_voice": setInputMode("voice"); setAppState("idle"); speak("Stem modus. Ik luister na elk bericht.").then(() => startListening()); break;
            case "set_button": setInputMode("button"); setAppState("idle"); speak("Knop modus. Druk de grote knop om te scannen."); break;
            case "repeat_setup": speak("Zeg knop of stem.").then(() => startListening()); break;
            case "accept": doAccept(); break;
            case "skip": doSkip(); break;
            case "add": doAddToBasket(result.qty ?? 1); break;
            case "confirm_qty": doAddToBasket(qtyRef.current); break;
            case "cancel":
                if (qtyTimerRef.current) { clearTimeout(qtyTimerRef.current); qtyTimerRef.current = null; }
                qtyRef.current = 0; setQty(0); setAppState("idle"); setProduct(null); speak("Geannuleerd."); break;
            case "scan": doScan(); break;
            case "read_basket": readBasket(); break;
            case "checkout": readBasket(); break;
            case "pay": doPayment(); break;
            case "read_balance":
                speak(balance !== null ? `Je saldo is ${balance.toFixed(2)} euro.` : "Saldo niet beschikbaar."); break;
            default:
                if (state !== "setup") speak("Ik begreep dat niet. Probeer opnieuw."); break;
        }
        // Auto-re-listen in voice mode
        if (inputModeRef.current === "voice" && state !== "scanning" && state !== "paying") {
            setTimeout(() => startListening(), 400);
        }
        setTranscript("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transcript, balance]);
    // â”€â”€ Derived values â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                            <span className="shop-phone__basket-total-pill">â‚¬{basketTotal.toFixed(2)}</span>
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

                {/* Product info â€” shown while scanned / counting / added */}
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
                            {product.currency}{Number(product.price).toFixed(2)}
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
