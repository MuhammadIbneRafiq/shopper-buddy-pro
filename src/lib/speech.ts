// Play raw 24kHz mono 16-bit PCM from base64
async function playPcm(base64: string): Promise<void> {
  const pcm = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const samples = new Int16Array(pcm.buffer);
  const ctx = new AudioContext({ sampleRate: 24000 });
  const buf = ctx.createBuffer(1, samples.length, 24000);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  return new Promise(r => { src.onended = () => { ctx.close(); r(); }; src.start(); });
}

let currentCtx: AudioContext | null = null;

export async function speak(text: string): Promise<void> {
  if (typeof window === 'undefined') return;
  stopSpeaking();

  try {
    const res = await fetch('/api/nova-sonic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Send a silent 0.1s WAV + the text as system prompt so Nova speaks it
      body: JSON.stringify({
        audioBase64: SILENT_WAV,
        systemPrompt: `Say exactly this and nothing else: "${text}"`,
      }),
    });
    if (!res.ok) throw new Error('nova-sonic ' + res.status);
    const { audioBase64 } = await res.json();
    if (audioBase64) await playPcm(audioBase64);
  } catch {
    // Fallback to browser TTS if Nova Sonic unavailable
    if (!('speechSynthesis' in window)) return;
    return new Promise(resolve => {
      const u = new SpeechSynthesisUtterance(text);
      u.onend = () => resolve(); u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  if (currentCtx) { currentCtx.close().catch(() => {}); currentCtx = null; }
}

// Minimal silent 16kHz mono WAV (0.1s = 1600 samples) as base64
// Used to trigger Nova Sonic TTS-only mode
const SILENT_WAV = (() => {
  const samples = 1600;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, samples * 2, true);
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
})();
