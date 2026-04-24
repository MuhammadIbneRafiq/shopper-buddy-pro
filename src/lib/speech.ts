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

export async function speak(text: string, opts: { rate?: number; pitch?: number } = {}): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  if (!voicesCache.length) await loadVoices();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const en = voicesCache.find((v) => /en-US|en-GB|en/i.test(v.lang));
    if (en) u.voice = en;
    u.rate = opts.rate ?? 1;
    u.pitch = opts.pitch ?? 1;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}
