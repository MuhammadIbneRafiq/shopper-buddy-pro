import { chromium } from 'playwright';

// ── 1. Claude Extraction ──────────────────────────────────────────────────

export async function extractProductInfo(imageBuffer: Buffer | string) {
    const base64Image = Buffer.isBuffer(imageBuffer) ? imageBuffer.toString('base64') : imageBuffer;
    
    // Fallback for different environment variables
    const token = process.env.VITE_AWS_BEARER_TOKEN_BEDROCK || process.env.AWS_BEARER_TOKEN_BEDROCK || (typeof import !== 'undefined' && import.meta?.env?.VITE_AWS_BEARER_TOKEN_BEDROCK);
    if (!token) throw new Error("Missing AWS Bedrock Token");

    const response = await fetch("https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-haiku-20240307-v1:0/converse", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
            system: [{
                text: `You are a strict product data extraction system.
Analyze the product image and return ONLY a valid JSON object. Do NOT guess missing fields.
Format exactly as:
{
  "brand": "",
  "product_name": "",
  "variant": "",
  "size": ""
}`
            }],
            messages: [{
                role: "user",
                content: [
                    { image: { format: "jpeg", source: { bytes: base64Image } } },
                    { text: "Extract product information as JSON." }
                ]
            }]
        })
    });

    if (!response.ok) throw new Error(`Bedrock API Error: ${response.status}`);
    
    const data = await response.json();
    const jsonStr = data.output.message.content[0].text;
    return parseJSON(jsonStr);
}


// ── 2. Albert Heijn Live Search (Playwright) ──────────────────────────────

export async function searchAlbertHeijn(query: string): Promise<any[]> {
    console.log(`\n[AH Search] Launching Headless Chromium to search for: "${query}"`);
    
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    const products: any[] = [];
    
    // Intercept network responses LIVE
    page.on('response', async (response) => {
        const url = response.url();
        
        // Target AH's search or GraphQL APIs where product JSON lives
        if (url.includes('search') || url.includes('zoeken') || url.includes('graphql') || url.includes('api/v1')) {
            try {
                if (response.headers()['content-type']?.includes('application/json')) {
                    const json = await response.json();
                    
                    // Deep extract products from the nested JSON payload
                    const extracted = extractAhProductsFromJSON(json);
                    if (extracted.length > 0) {
                        products.push(...extracted);
                    }
                }
            } catch (e) {
                // Ignore parsing errors for irrelevant background requests
            }
        }
    });

    try {
        const searchUrl = `https://www.ah.nl/zoeken?query=${encodeURIComponent(query)}`;
        console.log(`[AH Search] Navigating to: ${searchUrl}`);
        
        // Wait until network traffic settles to ensure API calls are caught
        await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 20000 });
        
        // Give an extra buffer for slower endpoints to resolve and parse
        await page.waitForTimeout(2000);
    } catch (error) {
        console.error(`[AH Search] Navigation Error (might be partial load):`, error);
    } finally {
        await browser.close();
        console.log(`[AH Search] Browser closed.`);
    }

    // Deduplicate by Name or ID
    const uniqueProductsMap = new Map();
    for (const p of products) {
        // AH sometimes prefixes names with brand, sometimes doesn't. Name is a good dedupe key.
        if (!uniqueProductsMap.has(p.name)) {
            uniqueProductsMap.set(p.name, p);
        }
    }
    
    const uniqueProducts = Array.from(uniqueProductsMap.values());
    console.log(`[AH Search] Successfully extracted ${uniqueProducts.length} unique products from API responses.\n`);
    
    return uniqueProducts;
}

// Recursive helper to traverse unknown JSON structures and pluck out product schemas
function extractAhProductsFromJSON(obj: any): any[] {
    let results: any[] = [];
    if (!obj || typeof obj !== 'object') return results;

    // Detect AH product signature (title, price, ID)
    if (obj.title && obj.price && (obj.webshopId || obj.hqId || obj.id)) {
        results.push({
            id: obj.webshopId || obj.hqId || obj.id,
            name: obj.title,
            brand: obj.brand || '',
            price: obj.price.now || obj.price || 0,
            unit: obj.salesUnitSize || obj.unit || ''
        });
    } else {
        // Traverse deeper
        for (const key of Object.keys(obj)) {
            if (Array.isArray(obj[key])) {
                for (const item of obj[key]) {
                    results.push(...extractAhProductsFromJSON(item));
                }
            } else if (typeof obj[key] === 'object') {
                results.push(...extractAhProductsFromJSON(obj[key]));
            }
        }
    }
    return results;
}


// ── 3. Ranking logic (Fuzzy Match) ──────────────────────────────────────────

export function rankProducts(products: any[], extractedInfo: any) {
    const searchTerms = [
        extractedInfo.brand,
        extractedInfo.product_name,
        extractedInfo.variant,
        extractedInfo.size
    ].filter(Boolean).join(' ').toLowerCase().match(/\w+/g) || [];

    if (searchTerms.length === 0) return products.slice(0, 5);

    const scoredProducts = products.map(product => {
        const productTerms = [product.brand, product.name, product.unit]
            .filter(Boolean).join(' ').toLowerCase().match(/\w+/g) || [];

        let score = 0;
        for (const term of searchTerms) {
            // Exact token
            if (productTerms.includes(term)) {
                score += 1.0;
            } 
            // Partial token
            else if (productTerms.some((pt: string) => pt.includes(term) || term.includes(pt))) {
                score += 0.5;
            }
        }
        
        // Brand boost
        if (extractedInfo.brand && product.brand && product.brand.toLowerCase().includes(extractedInfo.brand.toLowerCase())) {
            score += 1.5;
        }

        return { product, score };
    });

    return scoredProducts
        .sort((a, b) => b.score - a.score)
        .slice(0, 5) // Return top 5
        .map(p => p.product);
}


// ── 4. Grounded Selection (Claude) ────────────────────────────────────────

export async function selectBestMatch(extractedInfo: any, candidates: any[]) {
    if (candidates.length === 0) {
        return { product: null, confidence: 0, reasoning: "No candidate products found via search." };
    }

    const token = process.env.VITE_AWS_BEARER_TOKEN_BEDROCK || process.env.AWS_BEARER_TOKEN_BEDROCK || (typeof import !== 'undefined' && import.meta?.env?.VITE_AWS_BEARER_TOKEN_BEDROCK);
    
    const response = await fetch("https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-haiku-20240307-v1:0/converse", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
            system: [{
                text: `You are an AI product matching assistant.
Select the BEST matching product from the Candidates list based on the Extracted Data.
You MUST choose ONLY from the Candidates list.
Return ONLY JSON in this exact format:
{
  "product": { ... }, // The exact chosen candidate object, or null
  "confidence": 0.95, // Float 0-1
  "reasoning": "Brief explanation"
}`
            }],
            messages: [{
                role: "user",
                content: [{
                    text: `Extracted Data:\n${JSON.stringify(extractedInfo, null, 2)}\n\nCandidates List:\n${JSON.stringify(candidates, null, 2)}`
                }]
            }]
        })
    });

    if (!response.ok) throw new Error(`Bedrock Selection API Error: ${response.status}`);
    
    const data = await response.json();
    return parseJSON(data.output.message.content[0].text);
}


// ── 5. Full Pipeline Orchestration ────────────────────────────────────────

export async function processProductImage(imageBuffer: Buffer | string) {
    try {
        console.log("==========================================");
        console.log("1. Extracting info from image via Claude...");
        const extractedInfo = await extractProductInfo(imageBuffer);
        console.log("   Found:", extractedInfo);

        // Build a robust query string
        const query = [extractedInfo.brand, extractedInfo.product_name, extractedInfo.variant, extractedInfo.size]
            .filter(Boolean)
            .join(' ');

        if (!query.trim()) {
            throw new Error("Vision extraction yielded no usable search terms.");
        }

        console.log(`\n2. Querying Albert Heijn LIVE...`);
        const ahProducts = await searchAlbertHeijn(query);

        console.log(`3. Ranking top candidates...`);
        const topCandidates = rankProducts(ahProducts, extractedInfo);

        console.log(`4. Grounding final selection via Claude...`);
        const finalMatch = await selectBestMatch(extractedInfo, topCandidates);

        console.log(`\n✅ Pipeline Complete! Selected: ${finalMatch?.product?.name || 'None'}`);
        console.log("==========================================\n");

        return {
            success: true,
            input: extractedInfo,
            candidates_retrieved: ahProducts.length,
            match: finalMatch
        };
    } catch (error) {
        console.error("\n❌ Pipeline Error:", error);
        return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
        };
    }
}


// ── Helper ────────────────────────────────────────────────────────────────

function parseJSON(str: string) {
    let cleaned = str.replace(/```json/gi, '').replace(/```/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) cleaned = match[0];
    
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        throw new Error("Failed to parse Claude output: " + str);
    }
}
