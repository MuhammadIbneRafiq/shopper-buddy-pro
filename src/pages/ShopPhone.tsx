import { useEffect, useRef, useState, useCallback } from "react";
import { ShoppingCart, Package, ScanBarcode, Check } from "lucide-react";
import { speak, stopSpeaking } from "@/lib/speech";
import { toast } from "sonner";

/*
  ╔═══════════════════════════════════════════════════════════════╗
  ║  SHOPPER BUDDY — Flow (from whiteboard)                     ║
  ║                                                             ║
  ║  1. Scan  →  TTS: product description                       ║
  ║  2. "Add to basket?"                                        ║
  ║       Single tap  = YES  →  "How many?"                     ║
  ║       Double tap  = NO   →  skip, back to scan              ║
  ║  3. Tap N times   = quantity  (TTS speaks each number)      ║
  ║     2.5 s silence = auto-add                                ║
  ║     Hold          = add immediately                         ║
  ║  4. Back to scan                                            ║
  ║                                                             ║
  ║  Setup  (first launch):                                     ║
  ║    Single tap = button mode                                 ║
  ║    Hold       = voice mode                                  ║
  ║                                                             ║
  ║  "Explain only available functions"                         ║
  ║  → TTS only announces what the button can do RIGHT NOW      ║
  ╚═══════════════════════════════════════════════════════════════╝
*/

// ── TYPES ──────────────────────────────────────────────────────

type AppState =
    | "setup"     // choosing mode
    | "idle"      // ready to scan
    | "scanning"  // camera active, waiting for product
    | "scanned"   // product found, awaiting yes/no
    | "quantity"  // counting how many to add
    | "added";    // confirmation flash

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

// ── DEMO PRODUCTS ─────────────────────────────────────────────

const DEMO_PRODUCTS: Product[] = [
    { name: "Whole Milk 1L", brand: "Albert Heijn", price: 1.29, currency: "€", tts: "Whole milk, one litre, Albert Heijn, one euro twenty-nine cents." },
    { name: "Sliced Bread", brand: "Bolletje", price: 2.49, currency: "€", tts: "Sliced wholemeal bread, Bolletje, two euros forty-nine cents." },
    { name: "Free-Range Eggs 10x", brand: "Jumbo", price: 3.19, currency: "€", tts: "Ten free-range eggs, Jumbo, three euros nineteen cents." },
    { name: "Bananas 1kg", brand: "Chiquita", price: 1.79, currency: "€", tts: "One kilogram of Chiquita bananas, one euro seventy-nine cents." },
    { name: "Gouda Cheese 400g", brand: "Beemster", price: 4.99, currency: "€", tts: "Beemster Gouda cheese, four hundred grams, four euros ninety-nine cents." },
    { name: "Orange Juice 1.5L", brand: "Appelsientje", price: 2.89, currency: "€", tts: "Appelsientje orange juice, one and a half litres, two euros eighty-nine cents." },
];

function pickRandom(): Product {
    return DEMO_PRODUCTS[Math.floor(Math.random() * DEMO_PRODUCTS.length)];
}

// ── SPEECH RECOGNITION HOOK ───────────────────────────────────

interface SpeechRecognitionInstance {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((e: SpeechRecognitionEvent) => void) | null;
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
        rec.onresult = (e: SpeechRecognitionEvent) => {
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

// ═══════════════════════════════════════════════════════════════
// ── MAIN COMPONENT ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

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
    const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const holdFiredRef = useRef(false);
    const HOLD_MS = 500;

    const { listening, transcript, startListening, stopListening, setTranscript } =
        useSpeechRecognition();

    // Stable refs — read these inside timer callbacks to avoid stale closures
    const appStateRef = useRef(appState);
    const inputModeRef = useRef(inputMode);
    const basketRef = useRef(basket);
    const productRef = useRef(product);
    useEffect(() => { appStateRef.current = appState; }, [appState]);
    useEffect(() => { inputModeRef.current = inputMode; }, [inputMode]);
    useEffect(() => { basketRef.current = basket; }, [basket]);
    useEffect(() => { productRef.current = product; }, [product]);

    // ── Welcome TTS on first mount ────────────────────────────
    useEffect(() => {
        const t = setTimeout(() => {
            speak(
                "Welcome to Shopper Buddy. " +
                "Press once for button mode. " +
                "Hold for voice mode."
            );
        }, 700);
        return () => clearTimeout(t);
    }, []);

    // ── Cleanup ───────────────────────────────────────────────
    useEffect(() => () => { stopSpeaking(); }, []);

    // ── Camera ────────────────────────────────────────────────
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
            toast.message("Camera unavailable — using demo mode");
            setCameraOn(true);
        }
    }

    function stopCamera() {
        const s = videoRef.current?.srcObject as MediaStream | null;
        s?.getTracks().forEach((t) => t.stop());
        setCameraOn(false);
    }

    useEffect(() => () => { stopSpeaking(); stopCamera(); }, []);

    // ── Step handlers ───────────────────────────────────────────

    /** STEP 1: Scan product (press button once) */
    async function handleScan() {
        if (!cameraOn) {
            await startCamera();
        }
        setStep("scanning");
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
            setStep("description");
            speak(scanned.description + " Would you like to add this to your basket?");
            return;
        }

        try {
            const token = import.meta.env.VITE_AWS_BEARER_TOKEN_BEDROCK;
            if (!token) throw new Error("Missing AWS Bedrock Token in .env");

            const response = await fetch("https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-haiku-20240307-v1:0/converse", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    system: [
                        {
                            text: `You are an AI assistant for a visually impaired user. You receive an image from their camera.
You MUST output ONLY a valid JSON object describing the image. NO pleasantries, NO apologies, NO markdown code blocks.
Even if the image does not depict a grocery product (e.g., a face, person, or empty room), you MUST still return a JSON object describing what you see.
Format exactly as follows:
{
  "name": "Short name of what you see (or 'Unknown')",
  "brand": "Brand or 'N/A'",
  "price": 0.00,
  "currency": "€",
  "description": "Clear description of what you see so the user knows what they are pointing at."
}`
                        }
                    ],
                    messages: [
                        {
                            role: "user",
                            content: [
                                {
                                    image: {
                                        format: "jpeg",
                                        source: { bytes: base64Image }
                                    }
                                },
                                {
                                    text: "Provide the JSON description for this image."
                                }
                            ]
                        }
                    ]
                })
            });

            if (!response.ok) {
                throw new Error("Bedrock API Error: " + response.status);
            }

            const data = await response.json();
            const jsonStr = data.output.message.content[0].text;
            let scanned: ScannedProduct;

            try {
                let cleaned = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
                const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    cleaned = jsonMatch[0];
                }
                scanned = JSON.parse(cleaned);
            } catch (e) {
                // If it STILL fails to parse, fallback to using the raw text as the description
                scanned = {
                    name: "Unrecognized Item",
                    brand: "Unknown",
                    price: 0,
                    currency: "€",
                    description: jsonStr.replace(/"/g, '').substring(0, 200)
                };
            }

            setProduct(scanned);
            setStep("description");

            // Speak the product description
            speak(scanned.description + " Would you like to add this to your basket?");
        } catch (e) {
            console.error("Scan error:", e);
            speak("Sorry, I had trouble analyzing the image. Using demo product.");
            const scanned = randomProduct();
            setProduct(scanned);
            setStep("description");
            speak(scanned.description + " Would you like to add this to your basket?");
        }
        setCameraOn(true); // demo mode
    }
}

// ── Read basket aloud ─────────────────────────────────────
function readBasket() {
    const b = basketRef.current;
    if (b.length === 0) {
        speak("Your basket is empty.");
        return;
    }
    const total = b.reduce((s, i) => s + i.product.price * i.qty, 0);
    const itemNames = b.map(i => `${i.qty} ${i.product.name}`).join(", ");
    speak(`Your basket: ${itemNames}. Total: ${total.toFixed(2)} euros.`);
}

// ── Scan ──────────────────────────────────────────────────
async function doScan() {
    setAppState("scanning");
    speak("Scanning.");
    if (!cameraOn) await startCamera();
    await new Promise(r => setTimeout(r, 2000));
    const p = pickRandom();
    setProduct(p);
    setAppState("scanned");
    // Only explain what the user can do right now
    speak(
        `${p.tts} ` +
        `Press once to add. Double tap to skip.`
    );
}

// ── Skip product (double-tap in scanned state) ────────────
function doSkip() {
    if (qtyTimerRef.current) { clearTimeout(qtyTimerRef.current); qtyTimerRef.current = null; }
    if (doubleTapTimerRef.current) { clearTimeout(doubleTapTimerRef.current); doubleTapTimerRef.current = null; }
    qtyRef.current = 0;
    setQty(0);
    setAppState("idle");
    setProduct(null);
    speak("Skipped.");
}

// ── Accept product (single-tap in scanned state) ──────────
function doAccept() {
    setAppState("quantity");
    qtyRef.current = 0;
    setQty(0);
    // Only explain what the user can do right now
    speak("How many? Tap to count. Hold to confirm.");
}

// ── Commit qty items to basket ────────────────────────────
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

// ── Increment tap counter (quantity state) ────────────────
function incrementQty() {
    const next = qtyRef.current + 1;
    qtyRef.current = next;
    setQty(next);
    speak(String(next)); // TTS: "One", "Two", "Three"…

    // Reset auto-confirm countdown on every tap
    if (qtyTimerRef.current) clearTimeout(qtyTimerRef.current);
    qtyTimerRef.current = setTimeout(() => {
        doAddToBasket(qtyRef.current);
    }, QTY_CONFIRM_MS);
}

// ── SHORT PRESS handler (context-aware) ───────────────────
function handleShortPress() {
    const state = appStateRef.current;
    const mode = inputModeRef.current;

    // ── Setup: choose button mode ──
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
            // If a tap already happened within the window → double-tap = skip
            if (doubleTapTimerRef.current) {
                clearTimeout(doubleTapTimerRef.current);
                doubleTapTimerRef.current = null;
                doSkip();
            } else {
                // First tap — wait to see if a second arrives
                doubleTapTimerRef.current = setTimeout(() => {
                    doubleTapTimerRef.current = null;
                    doAccept(); // single-tap confirmed → go to quantity
                }, DOUBLE_TAP_MS);
            }

        } else if (state === "quantity") {
            incrementQty();
        }

    } else if (mode === "voice") {
        // In voice mode a tap also triggers the mic as a fallback
        startListening();
    }
}

// ── HOLD handler (context-aware) ──────────────────────────
function handleHoldFire() {
    const state = appStateRef.current;
    const mode = inputModeRef.current;

    // ── Setup: choose voice mode ──
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
                // Nothing counted yet → cancel
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
            // idle, added, etc. → read basket
            readBasket();
        }
    } else if (mode === "voice") {
        setIsHolding(true);
        startListening();
    }
}

// ── Hold release ──────────────────────────────────────────
function handleHoldRelease() {
    if (inputModeRef.current === "voice") {
        setIsHolding(false);
        stopListening();
    }
}

// ── Pointer events ────────────────────────────────────────
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

// ── Voice transcript processing ───────────────────────────
useEffect(() => {
    if (!transcript) return;
    const lower = transcript.toLowerCase().trim();
    const state = appStateRef.current;

    if (state === "scanned") {
        // User responded to "add to basket?"
        const num = parseInt(lower);
        if (!isNaN(num) && num > 0) {
            // Said a specific number → accept with that quantity
            doAddToBasket(num);
        } else if (lower.includes("yes") || lower.includes("add") || lower.includes("yeah")) {
            doAccept();
        } else if (lower.includes("no") || lower.includes("skip") || lower.includes("nope")) {
            doSkip();
        }

    } else if (state === "quantity") {
        // User responded to "how many?"
        const num = parseInt(lower);
        if (!isNaN(num) && num > 0) {
            doAddToBasket(num);
        } else if (lower.includes("done") || lower.includes("confirm") || lower.includes("yes")) {
            doAddToBasket(qtyRef.current);
        } else if (lower.includes("cancel") || lower.includes("no") || lower.includes("skip")) {
            if (qtyTimerRef.current) { clearTimeout(qtyTimerRef.current); qtyTimerRef.current = null; }
            qtyRef.current = 0;
            setQty(0);
            setAppState("idle");
            setProduct(null);
            speak("Cancelled.");
        }

    } else if (state === "idle") {
        if (lower.includes("scan") || lower.includes("product")) {
            doScan();
        } else if (lower.includes("basket") || lower.includes("cart") || lower.includes("total")) {
            readBasket();
        }
    }

    setTranscript("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, [transcript]);

// ── Derived values ────────────────────────────────────────
const basketTotal = basket.reduce((s, b) => s + b.product.price * b.qty, 0);
const basketCount = basket.reduce((s, b) => s + b.qty, 0);

// Button colour reflects current state
const btnClass = [
    "shop-phone__main-btn",
    appState === "added" ? "shop-phone__main-btn--success" :
        (isHolding || listening) ? "shop-phone__main-btn--listening" :
            appState === "scanning" ? "shop-phone__main-btn--scanning" :
                appState === "quantity" ? "shop-phone__main-btn--quantity" :
                    "shop-phone__main-btn--idle",
].join(" ");

// ── Render ────────────────────────────────────────────────
return (
    <div className="shop-phone">

        {/* ══ TOP 70%: camera + minimal info ══ */}
        <div className="shop-phone__top">

            <video ref={videoRef} className="shop-phone__video" playsInline muted />

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
                        <span className="shop-phone__basket-total-pill">€{basketTotal.toFixed(2)}</span>
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

            {/* Product info — shown while scanned / counting / added */}
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
                        {product.currency}{product.price.toFixed(2)}
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

        {/* ══ BOTTOM 30%: THE one big button ══ */}
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
