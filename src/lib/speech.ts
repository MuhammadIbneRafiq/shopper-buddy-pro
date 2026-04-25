import { stopActiveListening } from '@/lib/voice-orchestrator';

let activeWs: WebSocket | null = null;
let activeAudioCtx: AudioContext | null = null;

const WS_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview';

export function speak(text: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  stopActiveListening();
  stopSpeaking();

  const apiKey = (import.meta as any).env?.VITE_OPENAI_API_KEY as string | undefined;
  if (!apiKey) return Promise.resolve();
  const exactText = JSON.stringify(text.trim());

  return new Promise<void>((resolve) => {
    const ws = new WebSocket(WS_URL, ['realtime', `openai-insecure-api-key.${apiKey}`, 'openai-beta.realtime-v1']);
    activeWs = ws;
    const audioChunks: Uint8Array[] = [];

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: `You are a text-to-speech assistant. Read this text aloud exactly as written and in English. Never translate it, never paraphrase it, never answer it, and never change the wording: ${exactText}`,
          voice: 'alloy',
          output_audio_format: 'pcm16',
        },
      }));
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'session.updated') {
        ws.send(JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Read the prepared text now.' }] },
        }));
        ws.send(JSON.stringify({ type: 'response.create' }));
      } else if (msg.type === 'response.audio.delta') {
        const raw = atob(msg.delta);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        audioChunks.push(bytes);
      } else if (msg.type === 'response.done') {
        ws.close();
        if (audioChunks.length === 0) { resolve(); return; }
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
        src.onended = () => { ctx.close(); activeAudioCtx = null; resolve(); };
        src.start();
      } else if (msg.type === 'error') {
        console.error('[speak]', msg.error);
        ws.close();
        resolve();
      }
    };

    ws.onerror = () => { resolve(); };
    ws.onclose = () => { if (activeWs === ws) activeWs = null; };
  });
}

export function stopSpeaking() {
  if (activeWs) { activeWs.close(); activeWs = null; }
  if (activeAudioCtx) { activeAudioCtx.close().catch(() => {}); activeAudioCtx = null; }
}
