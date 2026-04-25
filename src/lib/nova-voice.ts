/**
 * useNovaVoice — OpenAI Realtime API (direct WebSocket, browser-compatible).
 * Same public interface: listening, processing, transcript,
 * startListening, stopListening, setTranscript, listeningRef.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { stopSpeaking } from '@/lib/speech';
import { registerStopListening } from '@/lib/voice-orchestrator';
import { toast } from 'sonner';

export function useNovaVoice() {
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const listeningRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  function setSync(val: boolean) { listeningRef.current = val; setListening(val); }

  useEffect(() => {
    registerStopListening(() => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
      }
      setSync(false);
    });

    return () => {
      registerStopListening(null);
      mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  const startListening = useCallback(async () => {
    if (listeningRef.current) return;

    const apiKey = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
    if (!apiKey) {
      toast.error('OpenAI API key not set (VITE_OPENAI_API_KEY)');
      return;
    }

    stopSpeaking();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        setSync(false);
        streamRef.current?.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size < 512) return;
        setProcessing(true);
        try {
          const body = new FormData();
          body.append('file', new File([blob], 'voice.webm', { type: mimeType }));
          body.append('model', 'whisper-1');
          const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}` },
            body,
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data?.error?.message ?? `OpenAI ${response.status}`);
          const text = typeof data?.text === 'string' ? data.text.trim() : '';
          if (text) setTranscript(text);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error('[OpenAI transcription]', message);
          toast.error('Voice error: ' + message);
        } finally {
          setProcessing(false);
        }
      };
      recorder.start(100);
      setSync(true);
    } catch {
      toast.error('Microphone access denied');
    }
  }, []);

  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      return;
    }
    setSync(false);
  }, []);

  return { listening, listeningRef, processing, transcript, setTranscript, startListening, stopListening };
}
