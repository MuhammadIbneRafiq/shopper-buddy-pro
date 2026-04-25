import { stopActiveListening } from '@/lib/voice-orchestrator';

let activeWs: WebSocket | null = null;
let activeAudioCtx: AudioContext | null = null;

const WS_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview';

function speakFallback(text: string): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) { resolve(); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export function speak(text: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  stopActiveListening();
  stopSpeaking();

  const apiKey = (import.meta as any).env?.VITE_OPENAI_API_KEY as string | undefined;
  if (!apiKey) {
    console.warn('[speak] No VITE_OPENAI_API_KEY — using browser TTS fallback');
    return speakFallback(text);
  }
  const exactText = JSON.stringify(text.trim());

  return new Promise<void>((resolve) => {
    let settled = false;
    function done() { if (!settled) { settled = true; resolve(); } }

    const ws = new WebSocket(WS_URL, ['realtime', `openai-insecure-api-key.${apiKey}`, 'openai-beta.realtime-v1']);
    activeWs = ws;
    const audioChunks: Uint8Array[] = [];

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: `You are a text-to-speech assistant. Read this text aloud verbatim in English. Do not paraphrase, translate, or respond — only speak: ${exactText}`,
          voice: 'alloy',
          output_audio_format: 'pcm16',
          turn_detection: null,
        },
      }));
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'session.updated') {
        ws.send(JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
        }));
        ws.send(JSON.stringify({ type: 'response.create' }));
      } else if (msg.type === 'response.audio.delta') {
        const raw = atob(msg.delta);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        audioChunks.push(bytes);
      } else if (msg.type === 'response.done') {
        ws.close();
        if (audioChunks.length === 0) { done(); return; }
        const total = audioChunks.reduce((s, c) => s + c.length, 0);
        const merged = new Uint8Array(total);
        let off = 0;
        for (const c of audioChunks) { merged.set(c, off); off += c.length; }
        const samples = new Int16Array(merged.buffer);
        const ctx = new AudioContext({ sampleRate: 24000 });
        activeAudioCtx = ctx;
        const buf = ctx.createBuffer(1, samples.length, 24000);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.onended = () => { ctx.close(); activeAudioCtx = null; done(); };
        ctx.resume().then(() => src.start()).catch(() => {
          ctx.close();
          activeAudioCtx = null;
          speakFallback(text).then(done);
        });
      } else if (msg.type === 'error') {
        console.error('[speak] OpenAI error:', msg.error);
        ws.close();
        speakFallback(text).then(done);
      }
    };

    ws.onerror = (err) => {
      console.error('[speak] WebSocket error', err);
      speakFallback(text).then(done);
    };
    ws.onclose = () => { if (activeWs === ws) activeWs = null; };
  });
}

export function stopSpeaking() {
  if (activeWs) { activeWs.close(); activeWs = null; }
  if (activeAudioCtx) { activeAudioCtx.close().catch(() => {}); activeAudioCtx = null; }
  if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
}
