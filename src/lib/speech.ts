import { stopActiveListening } from '@/lib/voice-orchestrator';

let activeWs: WebSocket | null = null;
let activeAudioCtx: AudioContext | null = null;
let activeHtmlAudio: HTMLAudioElement | null = null;
let activeWsAborted = false;
let iosAudioUnlocked = false;
let activeSpeakRequestId = 0;
let pendingIOSSpeakText: string | null = null;
let iosUnlockListenersAttached = false;

const WS_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview';
const IOS_TTS_TIMEOUT_MS = 7000;

function isCurrentSpeakRequest(requestId: number): boolean {
  return requestId === activeSpeakRequestId;
}

function detachIOSUnlockListeners(handler: EventListener) {
  if (typeof window === 'undefined') return;
  window.removeEventListener('pointerup', handler);
  window.removeEventListener('touchend', handler);
  window.removeEventListener('click', handler);
  window.removeEventListener('keydown', handler);
}

function attachIOSUnlockOnFirstGesture() {
  if (typeof window === 'undefined') return;
  if (iosUnlockListenersAttached) return;
  iosUnlockListenersAttached = true;

  const handler: EventListener = () => {
    detachIOSUnlockListeners(handler);
    iosUnlockListenersAttached = false;
    void unlockIOSAudioFromGesture().then((unlocked) => {
      if (!unlocked) return;
      const queuedText = pendingIOSSpeakText;
      pendingIOSSpeakText = null;
      if (queuedText) void speak(queuedText);
    });
  };

  window.addEventListener('pointerup', handler, { passive: true, once: true });
  window.addEventListener('touchend', handler, { passive: true, once: true });
  window.addEventListener('click', handler, { passive: true, once: true });
  window.addEventListener('keydown', handler, { once: true });
}

function speakFallback(text: string, requestId: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!isCurrentSpeakRequest(requestId)) { resolve(); return; }
    if (typeof window === 'undefined' || !window.speechSynthesis) { resolve(); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

function isIOSLikeBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

export function isIOSAudioUnlockNeeded(): boolean {
  return isIOSLikeBrowser() && !iosAudioUnlocked;
}

export async function unlockIOSAudioFromGesture(): Promise<boolean> {
  if (!isIOSLikeBrowser()) return true;
  if (iosAudioUnlocked) return true;
  if (typeof window === 'undefined') return false;

  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) {
    iosAudioUnlocked = true;
    return true;
  }

  try {
    const ctx: AudioContext = new AudioContextCtor();
    await ctx.resume();

    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);

    await ctx.close();
    iosAudioUnlocked = true;
    return true;
  } catch {
    return false;
  }
}

export async function playReadyChimeFromGesture(): Promise<void> {
  if (typeof window === 'undefined') return;
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) return;

  const ctx: AudioContext = new AudioContextCtor();
  await ctx.resume();

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.connect(ctx.destination);

  const first = ctx.createOscillator();
  first.type = 'sine';
  first.frequency.setValueAtTime(880, ctx.currentTime);
  first.connect(gain);

  const second = ctx.createOscillator();
  second.type = 'sine';
  second.frequency.setValueAtTime(1175, ctx.currentTime + 0.12);
  second.connect(gain);

  gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + 0.12);
  gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.14);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.26);

  first.start(ctx.currentTime);
  first.stop(ctx.currentTime + 0.1);
  second.start(ctx.currentTime + 0.12);
  second.stop(ctx.currentTime + 0.26);

  await new Promise((resolve) => setTimeout(resolve, 320));
  await ctx.close();
}

async function speakViaOpenAIAudioSpeech(text: string, apiKey: string, requestId: number): Promise<void> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), IOS_TTS_TIMEOUT_MS);
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      input: text,
      response_format: 'mp3',
    }),
    signal: controller.signal,
  });
  window.clearTimeout(timeoutId);

  if (!response.ok) {
    let message = `OpenAI ${response.status}`;
    try {
      const data = await response.json();
      if (data?.error?.message) message = data.error.message;
    } catch {
      // ignore parse errors and keep fallback message
    }
    throw new Error(message);
  }

  if (!isCurrentSpeakRequest(requestId)) return;

  const audioBlob = await response.blob();
  const objectUrl = URL.createObjectURL(audioBlob);

  await new Promise<void>((resolve, reject) => {
    const audio = new Audio(objectUrl);
    activeHtmlAudio = audio;
    audio.preload = 'auto';

    audio.onended = () => {
      URL.revokeObjectURL(objectUrl);
      if (activeHtmlAudio === audio) activeHtmlAudio = null;
      resolve();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      if (activeHtmlAudio === audio) activeHtmlAudio = null;
      reject(new Error('Failed to play TTS audio'));
    };

    audio.play().catch((error) => {
      URL.revokeObjectURL(objectUrl);
      if (activeHtmlAudio === audio) activeHtmlAudio = null;
      reject(error);
    });
  });
}

export function speak(text: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  stopActiveListening();
  stopSpeaking();
  const requestId = ++activeSpeakRequestId;

  if (isIOSLikeBrowser() && !iosAudioUnlocked) {
    pendingIOSSpeakText = text;
    attachIOSUnlockOnFirstGesture();
    return Promise.resolve();
  }

  const apiKey = (import.meta as any).env?.VITE_OPENAI_API_KEY as string | undefined;
  if (!apiKey) {
    console.warn('[speak] No VITE_OPENAI_API_KEY — using browser TTS fallback');
    return speakFallback(text, requestId);
  }

  if (isIOSLikeBrowser()) {
    return speakViaOpenAIAudioSpeech(text, apiKey, requestId).catch((error) => {
      console.warn('[speak] iOS OpenAI TTS failed; falling back to browser speech', error);
      return speakFallback(text, requestId);
    });
  }

  const exactText = JSON.stringify(text.trim());

  return new Promise<void>((resolve) => {
    let settled = false;
    function done() { if (!settled) { settled = true; resolve(); } }

    activeWsAborted = false;
    const ws = new WebSocket(WS_URL, ['realtime', `openai-insecure-api-key.${apiKey}`, 'openai-beta.realtime-v1']);
    activeWs = ws;
    const audioChunks: Uint8Array[] = [];

    ws.onopen = () => {
      if (!isCurrentSpeakRequest(requestId)) { ws.close(); done(); return; }
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
      if (!isCurrentSpeakRequest(requestId)) { ws.close(); done(); return; }
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
          speakFallback(text, requestId).then(done);
        });
      } else if (msg.type === 'error') {
        console.error('[speak] OpenAI error:', msg.error);
        ws.close();
        speakFallback(text, requestId).then(done);
      }
    };

    ws.onerror = () => {
      if (activeWsAborted) { done(); return; }
      console.warn('[speak] WebSocket error — falling back to browser TTS');
      speakFallback(text, requestId).then(done);
    };
    ws.onclose = () => { if (activeWs === ws) activeWs = null; };
  });
}

export function stopSpeaking() {
  if (activeWs) { activeWsAborted = true; activeWs.close(); activeWs = null; }
  if (activeAudioCtx) { activeAudioCtx.close().catch(() => {}); activeAudioCtx = null; }
  if (activeHtmlAudio) { activeHtmlAudio.pause(); activeHtmlAudio.currentTime = 0; activeHtmlAudio = null; }
  pendingIOSSpeakText = null;
  if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
}
