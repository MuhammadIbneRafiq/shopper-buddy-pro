# Shopper Buddy

A voice-first shopping assistant that helps you scan products, track your basket, and pay with bunq. Designed for accessibility and hands-free grocery shopping.

## Features

- **Dual interaction modes**: Button mode (tap/hold gestures) and Voice mode (OpenAI Realtime API)
- **Product scanning**: Camera-based product recognition using multimodal RAG with AWS Bedrock
- **Basket management**: Add/remove items, track quantities, automatic totals
- **Bunq integration**: Real-time balance checking and payment processing
- **Balance-aware prompts**: Spoken warnings when basket exceeds available balance
- **Triple-tap undo**: Quickly undo the last added product in button mode
- **Natural language voice commands**: Scan, basket, checkout, remove items, cancel
- **Liquid glass UI**: Modern bunq-inspired dark theme with glassmorphism

## Tech Stack

- **Frontend**: React 18, TypeScript, TailwindCSS, Radix UI
- **Voice**: OpenAI Realtime WebSocket API (gpt-4o-realtime-preview), browser `speechSynthesis` fallback
- **Speech-to-text**: OpenAI Whisper API
- **Product recognition**: AWS Bedrock (Claude 3 Haiku, Nova Sonic, Titan Embeddings)
- **Payments**: Bunq API (sandbox)
- **Hosting**: Vercel (serverless functions for RAG, bunq proxy, audio embeddings)
- **Build**: Vite with SWC

## Getting Started

### Prerequisites

- Node.js 18+
- Bunq sandbox account (for balance/payments)
- OpenAI API key (for voice/speech)
- AWS Bedrock credentials (for product recognition)

### Environment Variables

Create a `.env` file in the root:

```env
# OpenAI
VITE_OPENAI_API_KEY=sk-...

# AWS Bedrock
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_SESSION_TOKEN=...  # optional
VITE_AWS_BEARER_TOKEN_BEDROCK=...  # for embeddings

# Bunq
VITE_BUNQ_SESSION_TOKEN=...
VITE_BUNQ_USER_ID=...
VITE_BUNQ_ACCOUNT_ID=...
```

### Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Open http://localhost:8080
```

### Deployment to Vercel

```bash
# Deploy
vercel

# Or use git push to trigger auto-deploy
git push origin feature/elvir
```

## Usage

### Button Mode

- **Tap once**: Scan a product
- **Double-tap**: Skip product
- **Tap repeatedly**: Count quantity (speaks "One", "Two", ...)
- **Hold**: Confirm quantity / read basket
- **Triple-tap after adding**: Undo last item

### Voice Mode

- **Hold button**: Speak command, then release
- **Commands**:
  - "scan" or "scan this"
  - "basket" or "what's in my cart"
  - "checkout" or "pay"
  - "remove [product name]"
  - "cancel" or "skip"

### Balance Integration

- **Welcome prompt**: Spreads current bunq balance on startup (after first tap/hold)
- **Basket readout**: Includes balance and remaining funds / shortfall
- **Automatic warning**: Alerts when basket total exceeds balance

## Architecture

### Product Recognition Pipeline

1. Capture camera frame → base64 image
2. Agent 1: Claude 3 Haiku extracts visual attributes (name, brand, packaging, etc.)
3. Agent 2: Titan Text Embedding + cosine search against catalog (256-dim vectors)
4. Agent 3: Iterative refinement with Claude to verify matches
5. Agent 4: Final selection with confidence scoring

### Voice Architecture

- **OpenAI Realtime WebSocket**: Direct browser-to-OpenAI bidirectional streaming
- **Fallback**: Browser `speechSynthesis` when API key missing or WebSocket fails
- **Concurrency**: Shared voice orchestrator prevents overlapping input/output
- **Autoplay**: Welcome speech deferred to first user gesture (browser policy)

### Vercel Serverless Functions

- `api/rag.ts`: Product recognition with catalog data (~60s timeout)
- `api/bunq.ts`: Bunq API proxy (CORS workaround, ~15s timeout)
- `api/embed-audio.ts`: Audio embeddings for voice bucket matching
- `api/bucket-embeddings.ts`: Pre-computed voice command embeddings

## Project Structure

```
├── api/                    # Vercel serverless functions
│   ├── rag.ts             # Product recognition
│   ├── bunq.ts            # Bunq API proxy
│   └── ...
├── src/
│   ├── components/
│   │   ├── ui/            # Radix UI components
│   │   └── ShopPhone.tsx  # Main app component
│   ├── data/
│   │   ├── catalog-index.json
│   │   └── catalog-embeddings.bin
│   ├── lib/
│   │   ├── bunq.ts        # Bunq service
│   │   ├── speech.ts      # TTS (OpenAI + fallback)
│   │   ├── nova-voice.ts  # STT (Whisper)
│   │   ├── situationGraph.ts  # Voice command routing
│   │   └── voice-orchestrator.ts  # Concurrency manager
│   └── pages/
│       └── ShopPhone.tsx  # Main screen
├── vite.config.ts         # Dev server + API plugins
├── vercel.json            # Vercel function config
└── package.json
```

## Known Limitations

- **Audio autoplay**: Welcome prompt requires first user interaction (browser policy)
- **Bunq sandbox**: Currently uses sandbox API (not production payments)
- **Camera**: Requires HTTPS or localhost (browser security)
- **Voice accuracy**: Dependent on OpenAI Whisper and ambient noise

## License

MIT
