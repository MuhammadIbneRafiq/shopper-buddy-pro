import { useEffect, useRef, useState, useCallback } from "react";
import { ShoppingCart, Package, ScanBarcode, Check } from "lucide-react";
import { speak, stopSpeaking } from "@/lib/speech";
import { bunq } from "@/lib/bunq";
import { classifyVoiceIntent } from "@/lib/rag-buckets";
import { toast } from "sonner";

/*

    SHOPPER BUDDY  Flow (from whiteboard)

    1. Scan    TTS: product description
    2. "Add to basket?"
         Single tap  = YES    "How many?"
         Double tap  = NO     skip, back to scan
    3. Tap N times   = quantity  (TTS speaks each number)
       2.5 s silence = auto-add
       Hold          = add immediately
    4. Back to scan

    Setup  (first launch):
      Single tap = button mode
      Hold       = voice mode

    "Explain only available functions"
     TTS only announces what the button can do RIGHT NOW

*/

//  TYPES

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

//  DEMO PRODUCTS

const DEMO_PRODUCTS: Product[] = [
    { name: "Whole Milk 1L", brand: "Albert Heijn", price: 1.29, currency: "", tts: "Whole milk, one litre, Albert Heijn, one euro twenty-nine cents." },
    { name: "Sliced Bread", brand: "Bolletje", price: 2.49, currency: "", tts: "Sliced wholemeal bread, Bolletje, two euros forty-nine cents." },
    { name: "Free-Range Eggs 10x", brand: "Jumbo", price: 3.19, currency: "", tts: "Ten free-range eggs, Jumbo, three euros nineteen cents." },
    { name: "Bananas 1kg", brand: "Chiquita", price: 1.79, currency: "", tts: "One kilogram of Chiquita bananas, one euro seventy-nine cents." },
    { name: "Gouda Cheese 400g", brand: "Beemster", price: 4.99, currency: "", tts: "Beemster Gouda cheese, four hundred grams, four euros ninety-nine cents." },
    { name: "Orange Juice 1.5L", brand: "Appelsientje", price: 2.89, currency: "", tts: "Appelsientje orange juice, one and a half litres, two euros eighty-nine cents." },
];

function randomProduct(): Product {
    return DEMO_PRODUCTS[Math.floor(Math.random() * DEMO_PRODUCTS.length)];
}

//  SPEECH RECOGNITION HOOK

interface SpeechRecognitionInstance {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((e: any) => void) | null;
    onerror: ((e: any) => void) | null;
    onend: (() => void) | null;
    onstart: (() => void) | null;
    onaudiostart: (() => void) | null;
    onsoundstart: (() => void) | null;
    onspeechstart: (() => void) | null;
    onspeechend: (() => void) | null;
    onaudioend: (() => void) | null;
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
                    "not-allowed": "Microphone permission denied — allow mic in browser settings",
                    "service-not-allowed": "Service blocked — use localhost or HTTPS",
                    "audio-capture": "No microphone found or already in use",
                    "no-speech": "No speech detected (silence timeout)",
                    "network": "Network error communicating with speech service",
                    "aborted": "Recognition aborted (normal if stopListening was called)",
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

            rec.onstart = () => console.log("[SR] onstart: recognition started, waiting for speech...");
            rec.onaudiostart = () => console.log("[SR] onaudiostart: microphone opened");
            rec.onsoundstart = () => console.log("[SR] onsoundstart: sound detected");
            rec.onspeechstart = () => { speechStartedRef.current = true; console.log("[SR] onspeechstart: speech detected"); };
            rec.onspeechend = () => console.log("[SR] onspeechend: speech stopped, processing...");
            rec.onaudioend = () => console.log("[SR] onaudioend: microphone closed");
            rec.onend = () => { speechStartedRef.current = false; setListeningSync(false); console.log("[SR] onend: session ended"); };

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

//  MAIN COMPONENT

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

    // Stable refs  read these inside timer callbacks to avoid stale closures
    const appStateRef = useRef(appState);
    const inputModeRef = useRef(inputMode);
    const basketRef = useRef(basket);
    const productRef = useRef(product);
    useEffect(() => { appStateRef.current = appState; console.log(`[State] appState → ${appState}`); }, [appState]);
    useEffect(() => { inputModeRef.current = inputMode; console.log(`[State] inputMode → ${inputMode}`); }, [inputMode]);
    useEffect(() => { basketRef.current = basket; }, [basket]);
    useEffect(() => { productRef.current = product; }, [product]);

    // Speak welcome on first mount — mode is chosen by button gesture, not voice
    useEffect(() => {
        let cancelled = false;
        const t = setTimeout(() => {
            if (cancelled) return;
            console.log("[Init] speaking welcome prompt");
            speak("Welcome to Shopper Buddy. Press the button once for button mode: tap to scan and navigate. Or hold the button for voice mode: hold and speak your commands.");
        }, 700);
        return () => { cancelled = true; clearTimeout(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    //  Cleanup
    useEffect(() => () => { stopSpeaking(); }, []);

    //  Camera
    async function startCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment" },
            });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await new Promise<void>((res) => {
                    const v = videoRef.current!;
                    if (v.readyState >= 1) { res(); return; }
                    v.onloadedmetadata = () => res();
                });
                await videoRef.current.play();
            }
            setCameraOn(true);
        } catch {
            toast.message("Camera unavailable  using demo mode");
            setCameraOn(true);
        }
    }

    function stopCamera() {
        const s = videoRef.current?.srcObject as MediaStream | null;
        s?.getTracks().forEach((t) => t.stop());
        setCameraOn(false);
    }

    useEffect(() => () => { stopSpeaking(); stopCamera(); }, []);

    //  Step handlers

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

            // No product visible - never guess
            if (data.no_product) {
                speak(data.error || "No product visible. Please point the camera at a product.");
                setAppState("idle");
                return;
            }

            if (!data.success || !data.match || !data.match.product) {
                speak("I couldn't find that product in the catalog. Please scan it again."); setAppState("idle"); return;
            }

            const p = data.match.product;
            const confidence = data.match.confidence ?? 0;
            const price = parseFloat(p.price) || 0;
            const priceStr = price > 0 ? `${price.toFixed(2)} euros` : 'price unknown';
            const lowConf = confidence < 0.5;
            const scanned: Product = {
                name: p.name,
                brand: p.supermarket || 'Unknown',
                price,
                currency: "",
                tts: lowConf
                    ? `I found something that might be ${p.name}, ${priceStr}. I'm not fully sure, so please scan again if that's wrong.`
                    : `${p.name}, ${priceStr}.`
            };

            setProduct(scanned);
            setAppState("scanned");

            // Speak the product description
            speak(scanned.tts + " Would you like to add this to your basket?");
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("Scan error:", msg);
            toast.error("Scan failed: " + msg);
            speak("Sorry, I could not identify the product. Please try again.");
            setAppState("idle");
        }
    }

    // REMOVED PREMATURE CLOSING BRACE HERE


    //  Read basket aloud
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

    //  Bunq Payment
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

    //  Scan
    async function doScan() {
        await handleScan();
    }

    //  Skip product (double-tap in scanned state)
    function doSkip() {
        if (qtyTimerRef.current) { clearTimeout(qtyTimerRef.current); qtyTimerRef.current = null; }
        if (doubleTapTimerRef.current) { clearTimeout(doubleTapTimerRef.current); doubleTapTimerRef.current = null; }
        qtyRef.current = 0;
        setQty(0);
        setAppState("idle");
        setProduct(null);
        speak("Skipped.");
    }

    //  Accept product (single-tap in scanned state)
    function doAccept() {
        setAppState("quantity");
        qtyRef.current = 0;
        setQty(0);
        const prompt = inputModeRef.current === "voice"
            ? "How many? Just say the number."
            : "How many? Tap to count, then hold to confirm.";
        speak(prompt);
    }

    //  Commit qty items to basket
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

    //  Increment tap counter (quantity state)
    function incrementQty() {
        const next = qtyRef.current + 1;
        qtyRef.current = next;
        setQty(next);
        speak(String(next)); // TTS: "One", "Two", "Three"

        // Reset auto-confirm countdown on every tap
        if (qtyTimerRef.current) clearTimeout(qtyTimerRef.current);
        qtyTimerRef.current = setTimeout(() => {
            doAddToBasket(qtyRef.current);
        }, QTY_CONFIRM_MS);
    }

    //  SHORT PRESS handler (context-aware)
    function handleShortPress() {
        const state = appStateRef.current;
        const mode = inputModeRef.current;
        console.log(`[Button] shortPress | state: ${state} | mode: ${mode}`);

        //  Setup: choose button mode
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
                // If a tap already happened within the window  double-tap = skip
                if (doubleTapTimerRef.current) {
                    clearTimeout(doubleTapTimerRef.current);
                    doubleTapTimerRef.current = null;
                    doSkip();
                } else {
                    // First tap  wait to see if a second arrives
                    doubleTapTimerRef.current = setTimeout(() => {
                        doubleTapTimerRef.current = null;
                        doAccept(); // single-tap confirmed  go to quantity
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

    //  HOLD handler (context-aware)
    function handleHoldFire() {
        const state = appStateRef.current;
        const mode = inputModeRef.current;
        console.log(`[Button] holdFire | state: ${state} | mode: ${mode}`);

        //  Setup: choose voice mode
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
                    // Nothing counted yet  cancel
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
                // idle, added, etc.  read basket
                readBasket();
            }
        } else if (mode === "voice") {
            if (state === "scanning" || state === "paying" || state === "added") return;
            setIsHolding(true);
            startListening();
        }
    }

    //  Hold release
    function handleHoldRelease() {
        if (inputModeRef.current === "voice") {
            setIsHolding(false);
            stopListening();
        }
    }

    //  Pointer events
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

    //  Voice transcript processing
    useEffect(() => {
        if (!transcript) return;
        const lower = transcript.toLowerCase().trim();
        const state = appStateRef.current;
        //  Setup: voice picks mode
        if (state === "setup") {
            if (lower.includes("voice")) {
                setInputMode("voice");
                setAppState("idle");
                speak("Voice mode selected. I'll listen after each prompt. Say scan to start.").then(() => startListening());
            } else if (lower.includes("button")) {
                setInputMode("button");
                setAppState("idle");
                speak("Button mode selected. Press the big button to scan.");
            } else {
                // Didn't understand  ask again
                speak("Say button or voice.").then(() => startListening());
            }
            setTranscript("");
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
            // User responded to "add to basket?"
            const num = parseInt(lower);
            if (!isNaN(num) && num > 0) {
                // Said a specific number  accept with that quantity
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
            const num = parseInt(lower);
            if (!isNaN(num) && num > 0) {
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

    //  Derived values
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

    //  Render
    return (
        <div className="shop-phone">

            {/*  TOP 70%: camera + minimal info  */}
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
                            <span className="shop-phone__basket-total-pill">{basketTotal.toFixed(2)}</span>
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

                {/* Product info  shown while scanned / counting / added */}
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
                            {product.currency}{typeof product.price === 'number' ? product.price.toFixed(2) : product.price}
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

            {/*  BOTTOM 30%: THE one big button  */}
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
