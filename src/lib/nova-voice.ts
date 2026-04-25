import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

type SR = new () => any;
type WinSR = Window & { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };

export function useNovaVoice() {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const listeningRef = useRef(false);
  const recRef = useRef<any>(null);
  const stoppedRef = useRef(false);
  const retryRef = useRef(0);

  function setSync(val: boolean) { listeningRef.current = val; setListening(val); }

  const startListening = useCallback(() => {
    if (listeningRef.current) return;
    stoppedRef.current = false;
    retryRef.current = 0;
    const SR = (window as WinSR).SpeechRecognition || (window as WinSR).webkitSpeechRecognition;
    if (!SR) { toast.error('Speech recognition not supported — use Chrome'); return; }

    function start() {
      if (stoppedRef.current || listeningRef.current) return;
      const rec = new SR!();
      rec.continuous = false; rec.interimResults = false; rec.lang = 'en-US';
      rec.onresult = (e: any) => { retryRef.current = 0; setTranscript(e.results[0][0].transcript); };
      rec.onerror = (e: any) => {
        const code = e?.error ?? 'unknown';
        if (code === 'network' && !stoppedRef.current && ++retryRef.current <= 3) {
          setSync(false); setTimeout(start, retryRef.current * 1500); return;
        }
        if (code !== 'aborted' && code !== 'no-speech') toast.warning(`Mic: ${code}`);
        setSync(false);
      };
      rec.onend = () => setSync(false);
      recRef.current = rec;
      try { rec.start(); setSync(true); } catch { setSync(false); }
    }
    start();
  }, []);

  const stopListening = useCallback(() => {
    stoppedRef.current = true;
    try { recRef.current?.stop(); } catch { /* ignore */ }
    setSync(false);
  }, []);

  return { listening, listeningRef, processing: false, transcript, setTranscript, startListening, stopListening };
}
