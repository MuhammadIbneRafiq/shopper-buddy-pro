import { useEffect, useRef, useState, useCallback } from "react";
import {
    Camera,
    Mic,
    MicOff,
    ShoppingCart,
    Plus,
    Minus,
    Check,
    X,
    Volume2,
    RotateCcw,
    Package,
    ScanBarcode,
} from "lucide-react";
import { speak, stopSpeaking } from "@/lib/speech";
import { toast } from "sonner";

/*
  ╔═══════════════════════════════════════════════════════════════╗
  ║  SHOPPER BUDDY — PHONE MODE (Visually Impaired)             ║
  ║                                                             ║
  ║  Flow (from whiteboard):                                    ║
  ║    Open → [Press once] Scan product                         ║
  ║         → [Press & hold] Speech-to-text input               ║
  ║    Step 1: Scanning → Product description (spoken)          ║
  ║    Step 2: "Add to basket?" → Yes / No                      ║
  ║      If Yes → "How many?" → Add to basket                   ║
  ║    Step 3: End (back to scan)                               ║
  ╚═══════════════════════════════════════════════════════════════╝
*/

//
// ── TYPES ──────────────────────────────────────────────────────
//

type FlowStep = "idle" | "scanning" | "description" | "confirm" | "quantity" | "added";

interface ScannedProduct {
    name: string;
    brand: string;
    price: number;
    currency: string;
    description: string;
}

interface BasketItem {
    product: ScannedProduct;
    qty: number;
}

// ── DEMO PRODUCTS (no Supabase needed) ────────────────────────
const DEMO_PRODUCTS: ScannedProduct[] = [
    { name: "Whole Milk 1L", brand: "Albert Heijn", price: 1.29, currency: "€", description: "Fresh whole milk, one litre carton. Albert Heijn brand. Price: one euro twenty-nine cents." },
    { name: "Sliced Bread", brand: "Bolletje", price: 2.49, currency: "€", description: "Sliced wholemeal bread by Bolletje. Price: two euros forty-nine cents." },
    { name: "Free-Range Eggs 10x", brand: "Jumbo", price: 3.19, currency: "€", description: "Pack of ten free-range eggs. Jumbo brand. Price: three euros nineteen cents." },
    { name: "Bananas 1kg", brand: "Chiquita", price: 1.79, currency: "€", description: "One kilogram of Chiquita bananas. Price: one euro seventy-nine cents." },
    { name: "Gouda Cheese 400g", brand: "Beemster", price: 4.99, currency: "€", description: "Beemster aged Gouda cheese. Four hundred grams. Price: four euros ninety-nine cents." },
    { name: "Orange Juice 1.5L", brand: "Appelsientje", price: 2.89, currency: "€", description: "Appelsientje freshly squeezed orange juice. One and a half litres. Price: two euros eighty-nine cents." },
];

function randomProduct(): ScannedProduct {
    return DEMO_PRODUCTS[Math.floor(Math.random() * DEMO_PRODUCTS.length)];
}

// ── SPEECH RECOGNITION HOOK ───────────────────────────────────
function useSpeechRecognition() {
    const [listening, setListening] = useState(false);
    const [transcript, setTranscript] = useState("");
    const recognitionRef = useRef<any>(null);

    const startListening = useCallback(() => {
        const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SR) {
            toast.error("Speech recognition not supported in this browser");
            return;
        }
        const rec = new SR();
        rec.continuous = false;
        rec.interimResults = false;
        rec.lang = "en-US";
        rec.onresult = (e: any) => {
            const text = e.results[0][0].transcript;
            setTranscript(text);
        };
        rec.onerror = () => { setListening(false); };
        rec.onend = () => { setListening(false); };
        recognitionRef.current = rec;
        rec.start();
        setListening(true);
    }, []);

    const stopListening = useCallback(() => {
        recognitionRef.current?.stop();
        setListening(false);
    }, []);

    return { listening, transcript, startListening, stopListening, setTranscript };
}

// ═══════════════════════════════════════════════════════════════
// ── MAIN COMPONENT ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

export default function ShopPhone() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const [step, setStep] = useState<FlowStep>("idle");
    const [cameraOn, setCameraOn] = useState(false);
    const [product, setProduct] = useState<ScannedProduct | null>(null);
    const [qty, setQty] = useState(1);
    const [basket, setBasket] = useState<BasketItem[]>([]);
    const [showBasket, setShowBasket] = useState(false);

    const { listening, transcript, startListening, stopListening, setTranscript } = useSpeechRecognition();

    // ── Camera ──────────────────────────────────────────────────
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
                                    text: `You are an AI assistant helping a visually impaired user shop for groceries. You receive an image of a product from a phone camera. 
Respond ONLY with a valid JSON object in the exact following format, with no markdown formatting or extra text:
{
  "name": "Product Name",
  "brand": "Brand Name",
  "price": 0.00,
  "currency": "€",
  "description": "Short, highly descriptive text describing the product, its size/weight, brand, and a reasonable estimated price. Sound natural."
}
If you cannot identify the exact product, provide a helpful general description and make a reasonable guess. DO NOT wrap the JSON in markdown code blocks like \`\`\`json.`
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
                scanned = JSON.parse(jsonStr);
            } catch (e) {
                // remove any accidental markdown backticks just in case
                const cleaned = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
                scanned = JSON.parse(cleaned);
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
    }

    /** STEP 2: Confirm add to basket */
    function handleConfirmYes() {
        setStep("quantity");
        setQty(1);
        speak("How many would you like to add?");
    }

    function handleConfirmNo() {
        setStep("idle");
        setProduct(null);
        speak("Okay, product skipped. Ready to scan next product.");
    }

    /** Quantity step */
    function handleQuantityDone() {
        if (!product) return;
        const existing = basket.find((b) => b.product.name === product.name);
        if (existing) {
            existing.qty += qty;
            setBasket([...basket]);
        } else {
            setBasket([...basket, { product, qty }]);
        }
        setStep("added");
        speak(`Added ${qty} ${product.name} to your basket. You now have ${basket.length + (existing ? 0 : 1)} items. Ready to scan next product.`);
        setTimeout(() => {
            setStep("idle");
            setProduct(null);
        }, 3000);
    }

    // ── Voice command processing ────────────────────────────────
    useEffect(() => {
        if (!transcript) return;
        const lower = transcript.toLowerCase().trim();

        if (step === "description" || step === "confirm") {
            if (lower.includes("yes") || lower.includes("add") || lower.includes("yeah")) {
                handleConfirmYes();
            } else if (lower.includes("no") || lower.includes("skip") || lower.includes("nope")) {
                handleConfirmNo();
            }
        } else if (step === "quantity") {
            const num = parseInt(lower);
            if (!isNaN(num) && num > 0 && num < 100) {
                setQty(num);
                setTimeout(() => handleQuantityDone(), 500);
            }
        } else if (step === "idle") {
            if (lower.includes("scan") || lower.includes("product") || lower.includes("check")) {
                handleScan();
            } else if (lower.includes("basket") || lower.includes("cart")) {
                setShowBasket(true);
                const total = basket.reduce((s, b) => s + b.product.price * b.qty, 0);
                speak(`Your basket has ${basket.length} items. Total: ${total.toFixed(2)} euros.`);
            }
        }
        setTranscript("");
    }, [transcript]);

    // ── Basket total ────────────────────────────────────────────
    const basketTotal = basket.reduce((s, b) => s + b.product.price * b.qty, 0);
    const basketCount = basket.reduce((s, b) => s + b.qty, 0);

    // ── Render ──────────────────────────────────────────────────
    return (
        <div className="shop-phone">
            {/* ── Header ── */}
            <header className="shop-phone__header">
                <div className="shop-phone__logo">
                    <div className="shop-phone__logo-icon">
                        <Package size={24} />
                    </div>
                    <span className="shop-phone__title">Shopper Buddy</span>
                </div>
                <button
                    className="shop-phone__basket-btn"
                    onClick={() => {
                        setShowBasket(!showBasket);
                        if (!showBasket) {
                            speak(`Your basket has ${basket.length} items totalling ${basketTotal.toFixed(2)} euros.`);
                        }
                    }}
                    aria-label={`Basket: ${basketCount} items`}
                >
                    <ShoppingCart size={24} />
                    {basketCount > 0 && <span className="shop-phone__badge">{basketCount}</span>}
                </button>
            </header>

            {/* ── Camera viewfinder ── */}
            <div className="shop-phone__viewfinder">
                <video ref={videoRef} className="shop-phone__video" playsInline muted />
                <canvas ref={canvasRef} style={{ display: "none" }} />

                {!cameraOn && step === "idle" && (
                    <div className="shop-phone__cam-overlay">
                        <Camera size={56} strokeWidth={1.5} />
                        <p>Tap the big button below to start scanning</p>
                    </div>
                )}

                {step === "scanning" && (
                    <div className="shop-phone__cam-overlay shop-phone__cam-overlay--scanning">
                        <ScanBarcode size={64} className="scan-anim" />
                        <p className="text-pulse">Scanning…</p>
                    </div>
                )}

                {/* Scanning guide corners */}
                {(cameraOn || step === "scanning") && (
                    <div className="shop-phone__scan-frame">
                        <span className="corner tl" />
                        <span className="corner tr" />
                        <span className="corner bl" />
                        <span className="corner br" />
                    </div>
                )}
            </div>

            {/* ── Flow panels ── */}
            <div className="shop-phone__panel-area">

                {/* IDLE: Big scan button */}
                {step === "idle" && !showBasket && (
                    <div className="shop-phone__panel slide-up">
                        <button
                            className="shop-phone__big-btn shop-phone__big-btn--scan"
                            onClick={handleScan}
                            aria-label="Scan a product"
                        >
                            <ScanBarcode size={32} />
                            <span>Scan Product</span>
                        </button>
                        <button
                            className={`shop-phone__mic-btn ${listening ? "shop-phone__mic-btn--active" : ""}`}
                            onMouseDown={startListening}
                            onMouseUp={stopListening}
                            onTouchStart={startListening}
                            onTouchEnd={stopListening}
                            aria-label="Hold to speak"
                        >
                            {listening ? <Mic size={28} /> : <MicOff size={28} />}
                            <span>{listening ? "Listening…" : "Hold to speak"}</span>
                        </button>
                    </div>
                )}

                {/* DESCRIPTION: Show product and ask confirm */}
                {(step === "description" || step === "confirm") && product && (
                    <div className="shop-phone__panel slide-up">
                        <div className="shop-phone__product-card">
                            <div className="shop-phone__product-info">
                                <h2>{product.name}</h2>
                                <p className="shop-phone__product-brand">{product.brand}</p>
                            </div>
                            <div className="shop-phone__product-price">
                                {product.currency}{product.price.toFixed(2)}
                            </div>
                        </div>

                        <p className="shop-phone__question" aria-live="polite">
                            Add to basket?
                        </p>

                        <div className="shop-phone__confirm-row">
                            <button
                                className="shop-phone__big-btn shop-phone__big-btn--yes"
                                onClick={handleConfirmYes}
                                aria-label="Yes, add to basket"
                            >
                                <Check size={36} />
                                <span>Yes</span>
                            </button>
                            <button
                                className="shop-phone__big-btn shop-phone__big-btn--no"
                                onClick={handleConfirmNo}
                                aria-label="No, skip product"
                            >
                                <X size={36} />
                                <span>No</span>
                            </button>
                        </div>

                        <button
                            className={`shop-phone__mic-btn ${listening ? "shop-phone__mic-btn--active" : ""}`}
                            onMouseDown={startListening}
                            onMouseUp={stopListening}
                            onTouchStart={startListening}
                            onTouchEnd={stopListening}
                            aria-label="Hold to answer with voice"
                        >
                            {listening ? <Mic size={24} /> : <Volume2 size={24} />}
                            <span>{listening ? "Listening…" : "Or hold to answer"}</span>
                        </button>
                    </div>
                )}

                {/* QUANTITY: How many? */}
                {step === "quantity" && product && (
                    <div className="shop-phone__panel slide-up">
                        <p className="shop-phone__question" aria-live="polite">
                            How many <strong>{product.name}</strong>?
                        </p>
                        <div className="shop-phone__qty-row">
                            <button
                                className="shop-phone__qty-btn"
                                onClick={() => setQty(Math.max(1, qty - 1))}
                                aria-label="Decrease quantity"
                            >
                                <Minus size={32} />
                            </button>
                            <span className="shop-phone__qty-value" aria-live="polite">{qty}</span>
                            <button
                                className="shop-phone__qty-btn"
                                onClick={() => setQty(qty + 1)}
                                aria-label="Increase quantity"
                            >
                                <Plus size={32} />
                            </button>
                        </div>
                        <button
                            className="shop-phone__big-btn shop-phone__big-btn--yes"
                            onClick={handleQuantityDone}
                            aria-label={`Add ${qty} to basket`}
                        >
                            <ShoppingCart size={28} />
                            <span>Add {qty} to basket</span>
                        </button>

                        <button
                            className={`shop-phone__mic-btn ${listening ? "shop-phone__mic-btn--active" : ""}`}
                            onMouseDown={startListening}
                            onMouseUp={stopListening}
                            onTouchStart={startListening}
                            onTouchEnd={stopListening}
                            aria-label="Hold to say quantity"
                        >
                            {listening ? <Mic size={24} /> : <Volume2 size={24} />}
                            <span>{listening ? "Listening…" : "Or say the number"}</span>
                        </button>
                    </div>
                )}

                {/* ADDED: Confirmation */}
                {step === "added" && product && (
                    <div className="shop-phone__panel slide-up">
                        <div className="shop-phone__success">
                            <Check size={48} />
                            <h2>Added to basket!</h2>
                            <p>{qty}× {product.name}</p>
                        </div>
                    </div>
                )}

                {/* BASKET VIEW */}
                {showBasket && step === "idle" && (
                    <div className="shop-phone__panel slide-up">
                        <div className="shop-phone__basket-header">
                            <h2><ShoppingCart size={24} /> Your Basket</h2>
                            <button onClick={() => setShowBasket(false)} aria-label="Close basket">
                                <X size={28} />
                            </button>
                        </div>

                        {basket.length === 0 ? (
                            <p className="shop-phone__empty">Your basket is empty.<br />Scan a product to begin.</p>
                        ) : (
                            <>
                                <ul className="shop-phone__basket-list">
                                    {basket.map((b, i) => (
                                        <li key={i} className="shop-phone__basket-item">
                                            <div>
                                                <strong>{b.product.name}</strong>
                                                <span className="shop-phone__basket-brand">{b.product.brand}</span>
                                            </div>
                                            <div className="shop-phone__basket-right">
                                                <span className="shop-phone__basket-qty">×{b.qty}</span>
                                                <span className="shop-phone__basket-price">
                                                    {b.product.currency}{(b.product.price * b.qty).toFixed(2)}
                                                </span>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                                <div className="shop-phone__basket-total">
                                    <span>Total</span>
                                    <span>€{basketTotal.toFixed(2)}</span>
                                </div>
                                <button
                                    className="shop-phone__big-btn shop-phone__big-btn--scan"
                                    onClick={() => {
                                        setBasket([]);
                                        setShowBasket(false);
                                        speak("Basket cleared.");
                                    }}
                                    aria-label="Clear basket"
                                >
                                    <RotateCcw size={24} />
                                    <span>Clear Basket</span>
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
