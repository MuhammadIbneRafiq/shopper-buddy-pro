/**
 * useNovaVoice — replaces browser Web Speech API with Nova Multimodal Embeddings.
 *
 * Flow:
 *   1. startListening()  → opens mic via MediaRecorder (WebM/Opus or WAV)
 *   2. stopListening()   → stops recording, converts to WAV, sends to /api/embed-audio
 *   3. Cosine-matches the returned 1024-dim vector against pre-fetched bucket embeddings
 *   4. Sets `transcript` to the winning bucket ID (e.g. "SCAN_PRODUCT")
 *      so existing ShopPhone.tsx intent handlers work unchanged.
 *
 * The bucket embeddings are fetched once from /api/bucket-embeddings and cached.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NovaVoiceResult {
  /** Winning bucket ID, e.g. "SCAN_PRODUCT" */
  bucketId: string;
  score: number;
}

// ─── Cosine similarity ────────────────────────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ─── WAV encoding (PCM → WAV header + data) ──────────────────────────────────

function encodeWav(pcmBuffer: ArrayBuffer, sampleRate = 16000, numChannels = 1, bitsPerSample = 16): ArrayBuffer {
  const dataLen = pcmBuffer.byteLength;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);
  const write = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  write(36, 'data');
  view.setUint32(40, dataLen, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcmBuffer));
  return buffer;
}

// ─── Convert MediaRecorder blob to 16kHz mono WAV via Web Audio API ──────────

async function blobToWav(blob: Blob): Promise<ArrayBuffer> {
  const arrayBuf = await blob.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: 16000 });
  const decoded = await ctx.decodeAudioData(arrayBuf);
  await ctx.close();

  // Mix down to mono
  const mono = decoded.numberOfChannels === 1
    ? decoded.getChannelData(0)
    : (() => {
        const ch0 = decoded.getChannelData(0);
        const ch1 = decoded.getChannelData(1);
        return ch0.map((v, i) => (v + ch1[i]) / 2);
      })();

  // Float32 → Int16 PCM
  const pcm = new Int16Array(mono.length);
  for (let i = 0; i < mono.length; i++) {
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(mono[i] * 32767)));
  }

  return encodeWav(pcm.buffer, 16000, 1, 16);
}

// ─── Bucket cache ─────────────────────────────────────────────────────────────

let bucketCache: { id: string; embedding: number[] }[] | null = null;

async function getBuckets(): Promise<{ id: string; embedding: number[] }[]> {
  if (bucketCache) return bucketCache;
  const res = await fetch('/api/bucket-embeddings');
  if (!res.ok) throw new Error('Failed to load bucket embeddings');
  const data = await res.json();
  bucketCache = data.buckets;
  return bucketCache!;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNovaVoice() {
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');

  const listeningRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  function setListeningSync(val: boolean) {
    listeningRef.current = val;
    setListening(val);
  }

  // Pre-fetch bucket embeddings on mount so first voice command is fast
  useEffect(() => {
    getBuckets().catch(() => { /* will retry on first use */ });
  }, []);

  const startListening = useCallback(() => {
    if (listeningRef.current) return;

    navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } })
      .then((stream) => {
        streamRef.current = stream;
        chunksRef.current = [];

        // Prefer audio/webm;codecs=opus for broad browser support; fall back to audio/webm
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';

        const mr = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = mr;

        mr.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        mr.start(100); // collect chunks every 100ms
        setListeningSync(true);
      })
      .catch((err) => {
        console.error('[Nova] mic error:', err);
        toast.error('Microphone access denied');
      });
  }, []);

  const stopListening = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === 'inactive') {
      setListeningSync(false);
      return;
    }

    mr.onstop = async () => {
      setListeningSync(false);
      streamRef.current?.getTracks().forEach((t) => t.stop());

      const blob = new Blob(chunksRef.current, { type: mr.mimeType });
      if (blob.size < 1000) {
        // Too short — nothing recorded
        return;
      }

      setProcessing(true);
      try {
        // 1. Convert to WAV
        const wavBuf = await blobToWav(blob);
        const base64 = btoa(String.fromCharCode(...new Uint8Array(wavBuf)));

        // 2. Get audio embedding from Nova
        const embedRes = await fetch('/api/embed-audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioBase64: base64 }),
        });
        if (!embedRes.ok) throw new Error('embed-audio failed: ' + embedRes.status);
        const { embedding } = await embedRes.json() as { embedding: number[] };

        // 3. Cosine-match against bucket embeddings
        const buckets = await getBuckets();
        let bestId = '';
        let bestScore = -1;
        for (const b of buckets) {
          const s = cosine(embedding, b.embedding);
          if (s > bestScore) { bestScore = s; bestId = b.id; }
        }

        console.log(`[Nova] best bucket: ${bestId} (score: ${bestScore.toFixed(3)})`);

        // 4. Expose result as transcript (bucket ID) — ShopPhone reads this
        setTranscript(bestId);
      } catch (e) {
        console.error('[Nova] error:', e);
        toast.error('Voice recognition failed');
      } finally {
        setProcessing(false);
      }
    };

    mr.stop();
  }, []);

  return {
    listening,
    listeningRef,
    processing,
    transcript,
    setTranscript,
    startListening,
    stopListening,
  };
}
