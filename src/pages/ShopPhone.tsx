import { useEffect, useRef, useState } from "react";
import { ShoppingCart, Package, ScanBarcode, Check } from "lucide-react";
import { isIOSAudioUnlockNeeded, playReadyChimeFromGesture, speak, stopSpeaking, unlockIOSAudioFromGesture } from "@/lib/speech";
import { bunq } from "@/lib/bunq";
import { toast } from "sonner";
import { useNovaVoice } from "@/lib/nova-voice";
import { processVoiceInput } from "@/lib/situationGraph";

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

    Voice mode now uses Nova Multimodal Embeddings:
      Hold button → record audio → release → Nova classifies intent → action

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

//  MAIN COMPONENT

export default function ShopPhone() {
    const videoRef = useRef<HTMLVideoElement>(null);

    const [appState, setAppState] = useState<AppState>("setup");
    const [inputMode, setInputMode] = useState<InputMode>(null);
    const [product, setProduct] = useState<Product | null>(null);
    const [basket, setBasket] = useState<BasketItem[]>([]);
    const [balance, setBalance] = useState<number | null>(null);
    const [cameraOn, setCameraOn] = useState(false);
    const [isHolding, setIsHolding] = useState(false);
    const [showIOSAudioOverlay, setShowIOSAudioOverlay] = useState(false);
    const [scanPromptNonce, setScanPromptNonce] = useState(0);

    // Quantity counter (only used in "quantity" state)
    const [qty, setQty] = useState(0);
    const qtyRef = useRef(0);
    const qtyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const QTY_CONFIRM_MS = 2500; // auto-add after 2.5 s of silence

    // Double-tap detection (for "no/skip" in "scanned" state)
    const doubleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const DOUBLE_TAP_MS = 400; // window to detect double-tap
    const ADDED_UNDO_TAP_MS = 1200;
    const addedTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const addedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const addedTapCountRef = useRef(0);
    const addedUndoActiveRef = useRef(false);
    const lastAddedRef = useRef<{ productName: string; qty: number } | null>(null);
    const scanPromptRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Hold-press detection
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const holdFiredRef = useRef(false);
    const HOLD_MS = 500;

    // Nova voice hook — replaces browser Web Speech API
    const { listening, listeningRef, processing, transcript, startListening, stopListening, setTranscript } =
        useNovaVoice();

    // Stable refs  read these inside timer callbacks to avoid stale closures
    const appStateRef = useRef(appState);
    const inputModeRef = useRef(inputMode);
    const basketRef = useRef(basket);
    const productRef = useRef(product);
    const scanPromptNonceRef = useRef(scanPromptNonce);
    const balanceRef = useRef<number | null>(balance);
    const lowBalanceWarnedRef = useRef(false);
    const pendingWelcomeRef = useRef<string | null>(null);
    useEffect(() => { appStateRef.current = appState; console.log(`[State] appState → ${appState}`); }, [appState]);
    useEffect(() => { inputModeRef.current = inputMode; console.log(`[State] inputMode → ${inputMode}`); }, [inputMode]);
    useEffect(() => { basketRef.current = basket; }, [basket]);
    useEffect(() => { productRef.current = product; }, [product]);
    useEffect(() => { scanPromptNonceRef.current = scanPromptNonce; }, [scanPromptNonce]);
    useEffect(() => { balanceRef.current = balance; }, [balance]);
    useEffect(() => {
        setShowIOSAudioOverlay(isIOSAudioUnlockNeeded());
    }, []);

    async function onIOSAudioOverlayTap() {
        const unlocked = await unlockIOSAudioFromGesture();
        if (!unlocked) {
            toast.error("Please tap again to enable audio on iPhone");
            return;
        }
        void playReadyChimeFromGesture().catch(() => undefined);
        const welcome = pendingWelcomeRef.current;
        if (welcome) {
            pendingWelcomeRef.current = null;
            void speak(welcome);
            console.log("[Init] welcome text ready");
        }
        setShowIOSAudioOverlay(false);
        toast.success("Audio unlocked");
    }

    function scannedProductPrompt(scanned: Product) {
        const pricePart = Number.isFinite(scanned.price) && scanned.price > 0
            ? `${scanned.price.toFixed(2)} euros`
            : "price unknown";
        const brandPart = scanned.brand ? ` Brand: ${scanned.brand}.` : "";
        const base = `Product recognized: ${scanned.name}.${brandPart} Price: ${pricePart}. Would you like to add this to your basket?`;

        return inputModeRef.current === "voice"
            ? `${base} Hold the button and say yes or no.`
            : `${base} Press once to add. Double tap to skip.`;
    }

    function speakScannedProductPrompt(scanned: Product, nonce: number) {
        const prompt = scannedProductPrompt(scanned);
        speak(prompt);

        if (scanPromptRetryTimerRef.current) {
            clearTimeout(scanPromptRetryTimerRef.current);
            scanPromptRetryTimerRef.current = null;
        }

        scanPromptRetryTimerRef.current = setTimeout(() => {
            scanPromptRetryTimerRef.current = null;
            if (appStateRef.current !== "scanned") return;
            if (scanPromptNonceRef.current !== nonce) return;
            speak(prompt);
        }, 1400);
    }

    function finalizeScannedProduct(scanned: Product) {
        setProduct(scanned);
        setAppState("scanned");
        setScanPromptNonce((n) => n + 1);
    }

    async function refreshBalance() {
        const balanceStr = await bunq.getBalance();
        const nextBalance = parseFloat(balanceStr);
        const normalizedBalance = Number.isFinite(nextBalance) ? nextBalance : null;
        setBalance(normalizedBalance);
        return normalizedBalance;
    }

    function balancePromptText(currentBalance: number | null) {
        return currentBalance === null
            ? "I could not read your current balance right now."
            : `Your current balance is ${currentBalance.toFixed(2)} euros.`;
    }

    // Build welcome text on mount (no audio — browser blocks autoplay without user gesture).
    // The text is stored in pendingWelcomeRef and spoken on the first button press.
    useEffect(() => {
        let cancelled = false;
        void refreshBalance().then((currentBalance) => {
            if (cancelled) return;
            pendingWelcomeRef.current = `Welcome to Shopper Buddy. ${balancePromptText(currentBalance)} Press the button once for button mode: tap to scan and navigate. Or hold the button for voice mode: hold and speak your commands.`;
            console.log("[Init] welcome text ready");
        });
        return () => { cancelled = true; };
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

    useEffect(() => () => {
        if (scanPromptRetryTimerRef.current) {
            clearTimeout(scanPromptRetryTimerRef.current);
            scanPromptRetryTimerRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (appState !== "scanned") return;
        if (!product) return;
        if (scanPromptNonce === 0) return;
        speakScannedProductPrompt(product, scanPromptNonce);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appState, product, scanPromptNonce]);

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
            finalizeScannedProduct(scanned);
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

            finalizeScannedProduct(scanned);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("Scan error:", msg);
            toast.error("Scan failed: " + msg);
            speak("Sorry, I could not identify the product. Please try again.");
            setAppState("idle");
        }
    }

    //  Read basket aloud
    function readBasket() {
        const b = basketRef.current;
        const currentBalance = balanceRef.current;
        if (b.length === 0) {
            const balancePart = currentBalance === null ? "" : ` ${balancePromptText(currentBalance)}`;
            speak(`Your basket is empty. Scan a product to get started.${balancePart}`);
            return;
        }
        const total = b.reduce((s, i) => s + i.product.price * i.qty, 0);
        const itemCount = b.reduce((s, i) => s + i.qty, 0);
        const itemNames = b.map(i => `${i.qty} ${i.product.name}`).join(", ");
        let balancePart = "";
        if (currentBalance !== null) {
            const difference = Math.abs(currentBalance - total).toFixed(2);
            balancePart = total > currentBalance
                ? ` Your current balance is ${currentBalance.toFixed(2)} euros. Warning: you are ${difference} euros short.`
                : ` Your current balance is ${currentBalance.toFixed(2)} euros. You would have ${difference} euros remaining after payment.`;
        }
        speak(`You have ${itemCount} item${itemCount !== 1 ? "s" : ""}: ${itemNames}. Total is ${total.toFixed(2)} euros.${balancePart} Shall I proceed to checkout?`);
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
            void refreshBalance();
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
            ? "How many? Hold and say the number."
            : "How many? Tap to count, then hold to confirm.";
        speak(prompt);
    }

    function removeBasketQuantity(productName: string, count: number): BasketItem | null {
        const target = basketRef.current.find(item => item.product.name === productName);
        if (!target || count < 1) return null;

        const removedQty = Math.min(count, target.qty);
        setBasket(prev => prev
            .map(item => item.product.name === productName ? { ...item, qty: item.qty - removedQty } : item)
            .filter(item => item.qty > 0)
        );
        return { product: target.product, qty: removedQty };
    }

    function removeBasketItemByQuery(query: string): BasketItem | null {
        const normalizedQuery = query.toLowerCase().trim();
        if (!normalizedQuery) return null;

        const target = basketRef.current.find(item => {
            const name = item.product.name.toLowerCase();
            return name.includes(normalizedQuery) || normalizedQuery.includes(name);
        });

        if (!target) return null;
        setBasket(prev => prev.filter(item => item.product.name !== target.product.name));
        return target;
    }

    function undoLastAddedProduct() {
        const lastAdded = lastAddedRef.current;
        if (!lastAdded) {
            speak("There is nothing to undo.");
            return;
        }

        const removed = removeBasketQuantity(lastAdded.productName, lastAdded.qty);
        if (!removed) {
            speak("There is nothing to undo.");
            lastAddedRef.current = null;
            return;
        }

        lastAddedRef.current = null;
        addedUndoActiveRef.current = false;
        if (addedResetTimerRef.current) { clearTimeout(addedResetTimerRef.current); addedResetTimerRef.current = null; }
        setAppState("idle");
        setProduct(null);
        speak(`${removed.product.name} removed from your basket.`);
    }

    function scheduleAddedReset(delayMs: number = 2000) {
        if (addedResetTimerRef.current) clearTimeout(addedResetTimerRef.current);
        addedResetTimerRef.current = setTimeout(() => {
            addedResetTimerRef.current = null;
            addedUndoActiveRef.current = false;
            setAppState("idle");
            setProduct(null);
            addedTapCountRef.current = 0;
            if (addedTapTimerRef.current) { clearTimeout(addedTapTimerRef.current); addedTapTimerRef.current = null; }
        }, delayMs);
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

        lastAddedRef.current = { productName: p.name, qty: count };
        if (addedTapTimerRef.current) { clearTimeout(addedTapTimerRef.current); addedTapTimerRef.current = null; }
        addedTapCountRef.current = 0;
        addedUndoActiveRef.current = inputModeRef.current === "button";
        qtyRef.current = 0;
        setQty(0);
        setAppState("added");
        const addedPrompt = inputModeRef.current === "button"
            ? `${count} ${p.name} added. Triple tap to undo.`
            : `${count} ${p.name} added.`;
        void speak(addedPrompt).finally(() => {
            scheduleAddedReset(inputModeRef.current === "button" ? 4000 : 2000);
        });
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

        //  Setup: first tap — play welcome then confirm button mode
        if (state === "setup") {
            setInputMode("button");
            setAppState("idle");
            const welcome = pendingWelcomeRef.current;
            pendingWelcomeRef.current = null;
            speak(welcome ?? "Button mode selected. Tap once to scan a product. Double-tap to skip. Tap to count quantity, then hold to confirm. Triple tap after adding to undo the last product. Hold anytime to hear your basket.");
            return;
        }

        if (state === "scanning") return;

        if (mode === "button") {
            if (addedUndoActiveRef.current) {
                addedTapCountRef.current += 1;
                if (addedTapTimerRef.current) clearTimeout(addedTapTimerRef.current);
                if (addedResetTimerRef.current) { clearTimeout(addedResetTimerRef.current); addedResetTimerRef.current = null; }
                if (addedTapCountRef.current >= 3) {
                    addedTapCountRef.current = 0;
                    addedTapTimerRef.current = null;
                    undoLastAddedProduct();
                    return;
                }
                addedTapTimerRef.current = setTimeout(() => {
                    const taps = addedTapCountRef.current;
                    addedTapCountRef.current = 0;
                    addedTapTimerRef.current = null;
                    if (taps >= 3) undoLastAddedProduct();
                    else scheduleAddedReset(0);
                }, ADDED_UNDO_TAP_MS);

            } else if (state === "idle") {
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

        //  Setup: first hold — play welcome then confirm voice mode
        if (state === "setup") {
            setInputMode("voice");
            setAppState("idle");
            const welcome = pendingWelcomeRef.current;
            pendingWelcomeRef.current = null;
            speak(welcome ?? "Voice mode selected. Hold the button, speak your command, then release. Say things like: scan, basket, checkout, or cancel.");
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

    // ─── Voice transcript handler ─────────────────────────────────────────────
    useEffect(() => {
        if (!transcript) return;
        const action = processVoiceInput(transcript, {
            appState: appStateRef.current,
            inputMode: inputModeRef.current,
            basketTotal,
            basketCount,
            balance: balanceRef.current,
            productPrice: productRef.current?.price ?? null,
            productName: productRef.current?.name ?? null,
            allergens: [],
            isPublicPlace: inputModeRef.current === "button" && appStateRef.current === "checkout",
        });

        if (action.action === "set_voice") {
            setInputMode("voice");
            setAppState("idle");
            speak("Voice mode selected. Hold the button, speak your command, then release. Say things like: scan, basket, checkout, or cancel.");
        } else if (action.action === "set_button") {
            setInputMode("button");
            setAppState("idle");
            speak("Button mode selected. Tap once to scan a product. Double-tap to skip. Tap to count quantity, then hold to confirm. Triple tap after adding to undo the last product. Hold anytime to hear your basket.");
        } else if (action.action === "repeat_setup") {
            speak("Say button or voice to choose how you want to use Shopper Buddy.");
        } else if (action.action === "scan") {
            doScan();
        } else if (action.action === "read_basket" || action.action === "checkout") {
            readBasket();
        } else if (action.action === "remove" && action.productQuery) {
            const removed = removeBasketItemByQuery(action.productQuery);
            if (removed) speak(`${removed.product.name} removed from your basket.`);
            else speak(`I could not find ${action.productQuery} in your basket.`);
        } else if (action.action === "accept") {
            doAccept();
        } else if (action.action === "skip") {
            doSkip();
        } else if (action.action === "add" && action.qty) {
            doAddToBasket(action.qty);
        } else if (action.action === "confirm_qty") {
            doAddToBasket(Math.max(1, qtyRef.current));
        } else if (action.action === "pay") {
            doPayment();
        } else if (action.action === "cancel") {
            if (appStateRef.current === "quantity") {
                if (qtyTimerRef.current) { clearTimeout(qtyTimerRef.current); qtyTimerRef.current = null; }
                qtyRef.current = 0;
                setQty(0);
                setAppState("idle");
                setProduct(null);
                speak("Cancelled.");
            } else if (appStateRef.current === "checkout") {
                setAppState("idle");
                speak("OK, back to shopping.");
            } else {
                doSkip();
            }
        } else if (action.action === "read_balance") {
            speak(balancePromptText(balanceRef.current));
        }

        setTranscript("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transcript]);

    //  Derived values
    const basketTotal = basket.reduce((s, b) => s + b.product.price * b.qty, 0);
    const basketCount = basket.reduce((s, b) => s + b.qty, 0);

    useEffect(() => {
        if (balance === null || basketCount === 0) {
            lowBalanceWarnedRef.current = false;
            return;
        }

        if (basketTotal > balance) {
            if (!lowBalanceWarnedRef.current) {
                const shortBy = (basketTotal - balance).toFixed(2);
                speak(`Warning. Your basket total of ${basketTotal.toFixed(2)} euros exceeds your current balance of ${balance.toFixed(2)} euros. You are short by ${shortBy} euros.`);
                lowBalanceWarnedRef.current = true;
            }
            return;
        }

        lowBalanceWarnedRef.current = false;
    }, [basketTotal, basketCount, balance]);

    // Button colour reflects current state
    const btnClass = [
        "shop-phone__main-btn",
        appState === "added" ? "shop-phone__main-btn--success" :
            (isHolding || listening) ? "shop-phone__main-btn--listening" :
                processing ? "shop-phone__main-btn--scanning" :
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

                {showIOSAudioOverlay && (
                    <div
                        className="shop-phone__ios-audio-overlay"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Enable audio"
                    >
                        <button
                            type="button"
                            className="shop-phone__ios-audio-hitarea"
                            onClick={() => {
                                void onIOSAudioOverlayTap();
                            }}
                            aria-label="Enable audio"
                        />
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

                {/* Listening / processing indicator */}
                {(listening || processing) && (
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
                    disabled={showIOSAudioOverlay}
                    aria-label="Main action button"
                    style={{ touchAction: "none" }}
                >
                    <span className="shop-phone__main-btn-glow" />
                </button>
            </div>
        </div>
    );
}
