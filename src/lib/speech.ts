// Tiny wrapper around the Web Speech API for TTS (with graceful fallback).
let voicesCache: SpeechSynthesisVoice[] = [];

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const v = window.speechSynthesis.getVoices();
    if (v.length) { voicesCache = v; resolve(v); return; }
    window.speechSynthesis.onvoiceschanged = () => {
      voicesCache = window.speechSynthesis.getVoices();
      resolve(voicesCache);
    };
  });
}

export async function speak(text: string, opts: { rate?: number; pitch?: number } = {}) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  if (!voicesCache.length) await loadVoices();
  const u = new SpeechSynthesisUtterance(text);
  const en = voicesCache.find((v) => /en/i.test(v.lang));
  if (en) u.voice = en;
  u.rate = opts.rate ?? 1;
  u.pitch = opts.pitch ?? 1;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}
