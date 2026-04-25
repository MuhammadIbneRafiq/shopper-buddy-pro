/**
 * useNovaVoice — records audio via MediaRecorder, sends to /api/nova-sonic,
 * plays back the TTS audio response, and exposes the transcript.
 */
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

// Convert MediaRecorder blob → 16kHz mono WAV via Web Audio API
async function blobToWav(blob: Blob): Promise<string> {
  const arrayBuf = await blob.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: 16000 });
  const decoded = await ctx.decodeAudioData(arrayBuf);
  await ctx.close();

  const ch0 = decoded.getChannelData(0);
  const mono = decoded.numberOfChannels === 1 ? ch0 : ch0.map((v, i) => (v + decoded.getChannelData(1)[i]) / 2);
  const pcm = new Int16Array(mono.length);
  for (let i = 0; i < mono.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, mono[i] * 32767));

  const wav = new ArrayBuffer(44 + pcm.byteLength);
  const v = new DataView(wav);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.byteLength, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, pcm.byteLength, true);
  new Uint8Array(wav, 44).set(new Uint8Array(pcm.buffer));

  return btoa(String.fromCharCode(...new Uint8Array(wav)));
}

// Play raw 24kHz mono 16-bit PCM from base64
async function playPcm(base64: string) {
  if (!base64) return;
  const pcm = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const samples = new Int16Array(pcm.buffer);
  const ctx = new AudioContext({ sampleRate: 24000 });
  const buf = ctx.createBuffer(1, samples.length, 24000);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  await new Promise<void>(r => { src.onended = () => r(); src.start(); });
  await ctx.close();
}

export function useNovaVoice() {
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const listeningRef = useRef(false);
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  function setSync(val: boolean) { listeningRef.current = val; setListening(val); }

  const startListening = useCallback(() => {
    if (listeningRef.current) return;
    navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } })
      .then(stream => {
        streamRef.current = stream;
        chunksRef.current = [];
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
        const mr = new MediaRecorder(stream, { mimeType: mime });
        mrRef.current = mr;
        mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        mr.onstop = async () => {
          setSync(false);
          streamRef.current?.getTracks().forEach(t => t.stop());
          const blob = new Blob(chunksRef.current, { type: mr.mimeType });
          if (blob.size < 1000) return;
          setProcessing(true);
          try {
            const audioBase64 = await blobToWav(blob);
            const res = await fetch('/api/nova-sonic', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ audioBase64 }),
            });
            if (!res.ok) throw new Error('nova-sonic ' + res.status);
            const { transcript: t, audioBase64: ttsAudio } = await res.json();
            if (t) setTranscript(t);
            if (ttsAudio) await playPcm(ttsAudio);
          } catch (e: any) {
            console.error('[Nova]', e.message);
            toast.error('Voice error: ' + e.message);
          } finally {
            setProcessing(false);
          }
        };
        mr.start(100);
        setSync(true);
      })
      .catch(() => toast.error('Microphone access denied'));
  }, []);

  const stopListening = useCallback(() => {
    if (mrRef.current?.state !== 'inactive') mrRef.current?.stop();
    else setSync(false);
  }, []);

  return { listening, listeningRef, processing, transcript, setTranscript, startListening, stopListening };
}
