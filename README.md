# Shopper Buddy Pro

A button-first, camera-powered shopping assistant for the visually impaired. Point your phone at a shelf, tap the button — the AI reads the product aloud. No screen-reading required.

---

## Features

- **Button-first interaction** — one large button drives the entire experience via tap and hold gestures
- **Camera product recognition** — multimodal RAG pipeline identifies products from a live camera frame
- **Spoken results** — product name, brand, and price read aloud instantly via AI TTS
- **Voice mode** — hold button and speak to add items, check basket
- **Basket management** — tap to count quantity, voice commands to add/remove, auto-totals
- **bunq integration** — live balance check
- **Balance-aware warnings** — spoken alert when basket exceeds available balance
- **Multilingual** — English and Dutch voice commands supported

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite (SWC), TailwindCSS, Radix UI |
| Vision / RAG | AWS Bedrock — Claude 3 Haiku (vision) + Amazon Titan Embed Text v2 |
| Speech-to-text | OpenAI Whisper API |
| Text-to-speech | OpenAI GPT-4o Realtime API (streaming PCM) |
| Balance | bunq API |
| Hosting | Vercel (serverless functions) |
| Data | Supabase |

---

## Getting Started

### Prerequisites

- Node.js 18+
- AWS account with Bedrock access (Claude 3 Haiku + Titan Embeddings enabled in your region)
- OpenAI API key
- bunq sandbox account
- Supabase project

### 1. Clone & Install

```bash
git clone https://github.com/MuhammadIbneRafiq/shopper-buddy-pro.git
cd shopper-buddy-pro
npm install
```

### 2. Environment Variables

Create a `.env` file in the root directory:

```env
# OpenAI
VITE_OPENAI_API_KEY=sk-...

# AWS Bedrock
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_SESSION_TOKEN=...
AWS_DEFAULT_REGION=us-east-1
AWS_BEARER_TOKEN_BEDROCK=...

# bunq
VITE_BUNQ_API_KEY=...
VITE_BUNQ_SESSION_TOKEN=...
VITE_BUNQ_USER_ID=...
VITE_BUNQ_ACCOUNT_ID=...

# Supabase
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_SUPABASE_PROJECT_ID=...
```

### 3. Build the Product Catalogue

The RAG pipeline requires pre-computed embeddings. Run once before starting the dev server:

```bash
node scripts/embed-catalog.mjs
```

This reads the supermarket catalogue (covering the 5 largest chains in the Netherlands, data last updated March 2026), embeds each product using Amazon Titan Text Embeddings v2, and outputs:

- `src/data/catalog-embeddings.bin` — Float32 binary vectors (256-dim, ~67 MB)
- `src/data/catalog-index.json` — product metadata index (~12.5 MB)

The script is resumable — if interrupted, re-running picks up from the last checkpoint.

### 4. Start the Dev Server

```bash
npm run dev
```

Open [http://localhost:8080](http://localhost:8080) in a browser.

> **Note:** Camera access requires HTTPS or localhost. On mobile, use a tunnel like `ngrok` or deploy to Vercel.

---

## Usage

### First Launch

On first open, the app speaks a welcome prompt asking you to choose an input mode:
- **Single tap** → Button mode
- **Hold** → Voice mode

### Button Mode

| Gesture | Action |
|---|---|
| Single tap | Scan product |
| Double-tap | Skip / dismiss |
| Tap repeatedly | Count quantity (TTS announces each number) |
| Hold | Confirm quantity / read basket |
| Triple-tap after adding | Undo last item |

### Voice Mode

Hold the button, speak, then release.

| Command | Action |
|---|---|
| "scan" / "scan this" | Scan product |
| "basket" / "mandje" | Read basket aloud |
| "remove [product]" | Remove item from basket |
| "cancel" / "stop" | Cancel / go back |
| Number words ("two" / "twee") | Set quantity |

---

## Architecture

### Product Recognition Pipeline (RAG)

```
Camera frame (base64)
  └─► Claude 3 Haiku (vision)
        └─► Extracts: brand, name, quantity, packaging, colour, label text
              └─► Amazon Titan Embed Text v2 → 256-dim vector
                    └─► Cosine similarity search against catalogue embeddings
                          └─► Confidence scoring → spoken result or probable-match disclaimer
```

### Speech Pipeline

```
Voice input:   hold button → MediaRecorder → WebM/Opus blob → OpenAI Whisper → transcript
Intent:        rule-based situation graph (English + Dutch keywords) → action
Voice output:  speak(text) → OpenAI GPT-4o Realtime API → streaming PCM → browser audio
```

### Serverless Functions (Vercel)

| Function | Purpose |
|---|---|---|
| `api/rag.ts` | Product recognition, catalogue search |
| `api/bunq/[...path].ts` | bunq API proxy (CORS) |
| `api/embed-audio.ts` | Audio → Bedrock embedding |
| `api/bucket-embeddings.ts` | Pre-computed intent bucket embeddings |

---

## Project Structure

```
shopper-buddy-pro/
├── api/                        # Vercel serverless functions
│   ├── rag.ts                  # RAG product recognition
│   ├── bunq/[...path].ts       # bunq API proxy
│   ├── embed-audio.ts          # Audio embedding
│   └── bucket-embeddings.ts    # Intent bucket embeddings
├── scripts/
│   ├── embed-catalog.mjs       # Build catalogue embeddings (run once)
│   ├── setup-opensearch.mjs    # Optional: AWS OpenSearch setup
│   └── test-rag.mjs            # Test the RAG pipeline
├── src/
│   ├── data/
│   │   ├── catalog-index.json       # Product metadata
│   │   ├── catalog-embeddings.bin   # Pre-computed vectors
│   │   └── supermarket-catalog.json # Source catalogue data
│   ├── lib/
│   │   ├── speech.ts           # TTS (OpenAI Realtime + browser fallback)
│   │   ├── nova-voice.ts       # STT (Whisper)
│   │   ├── situationGraph.ts   # Voice intent routing
│   │   ├── bunq.ts             # bunq service
│   │   └── voice-orchestrator.ts
│   ├── pages/
│   │   └── ShopPhone.tsx       # Main app screen & state machine
│   └── components/ui/          # Radix UI / shadcn components
├── vercel.json
├── vite.config.ts
└── package.json
```

---

## Scripts

```bash
npm run dev          # Start dev server (port 8080)
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Run tests once
npm run test:watch   # Run tests in watch mode

node scripts/embed-catalog.mjs      # Build product catalogue embeddings
node scripts/setup-opensearch.mjs   # Set up AWS OpenSearch (optional)
node scripts/test-rag.mjs           # Test RAG pipeline end-to-end
```

---

## Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Or push to trigger auto-deploy
git push origin feature/elvir
```

Add all environment variables from your `.env` file to your Vercel project settings before deploying.

---

## Known Limitations

- **Audio autoplay** — welcome prompt requires a user gesture first (browser security policy)
- **bunq sandbox** — currently uses sandbox API, not live payments
- **Camera** — requires HTTPS or localhost; use `ngrok` or Vercel for mobile testing
- **Catalogue coverage** — limited to products from the 5 largest Dutch supermarket chains
- **Voice accuracy** — dependent on OpenAI Whisper and ambient noise conditions

---

## License

MIT
