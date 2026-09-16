'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { UnlockGate } from '@/components/UnlockGate';
import { useVault } from '@/lib/vault';
import { saveAudioThought, saveTextThought } from '@/lib/thoughts';
import { track } from '@/lib/signals';
import { toDurationBucket } from '@unsaid/types';

type Stage = 'capturing' | 'deciding' | 'saving' | 'saved' | 'released';

/** Prompts for the "I do not know" path — open questions, never diagnostic. */
const GUIDED_PROMPTS = [
  'What has been sitting with you today?',
  'Is there something you have decided not to say to anyone?',
  'What would you say if there were no consequences?',
];

function CaptureScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const { token, key, keyVersion } = useVault();

  const isVoice = params.get('mode') === 'voice';
  const guided = params.get('guided') === '1';

  const [stage, setStage] = useState<Stage>('capturing');
  const [text, setText] = useState('');
  const [audio, setAudio] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [releasedFrom, setReleasedFrom] = useState<'capturing' | 'deciding'>('capturing');
  const [prompt] = useState(
    () => GUIDED_PROMPTS[Math.floor(Math.random() * GUIDED_PROMPTS.length)] ?? '',
  );

  const [silent, setSilent] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const meterRef = useRef<HTMLDivElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const silentSinceRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // The recorder's onstop closure captures state at start; a ref stays current.
  const elapsedRef = useRef(0);

  const stopMeter = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    silentSinceRef.current = null;
  }, []);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
    }, 1000);
    return () => clearInterval(timer);
  }, [recording]);

  // Releasing the microphone when leaving the screen is a privacy behaviour,
  // not just cleanup — a recording indicator that lingers is alarming here.
  useEffect(() => {
    return () => {
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      stopMeter();
    };
  }, [stopMeter]);

  // Hearing it back before deciding: committing to audio you cannot review is
  // asking for a choice with the evidence withheld.
  const audioUrl = useMemo(() => (audio ? URL.createObjectURL(audio) : null), [audio]);
  useEffect(() => {
    if (!audioUrl) return;
    return () => URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => chunksRef.current.push(event.data);
      recorder.onstop = () => {
        stopMeter();
        setAudio(new Blob(chunksRef.current, { type: recorder.mimeType }));
        stream.getTracks().forEach((audioTrack) => audioTrack.stop());
        track({
          name: 'capture_completed',
          captureType: 'audio',
          durationBucket: toDurationBucket(elapsedRef.current * 1000),
        });
        setStage('deciding');
      };
      // A timer proves the clock runs, not that the microphone hears anything.
      // Drive the bar straight from the node so this costs no re-renders.
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);
      audioCtxRef.current = ctx;
      setSilent(false);
      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i += 1) {
          const d = ((samples[i] ?? 128) - 128) / 128;
          sum += d * d;
        }
        const rms = Math.sqrt(sum / samples.length);
        if (meterRef.current) {
          meterRef.current.style.transform = `scaleX(${Math.min(1, rms * 3).toFixed(3)})`;
        }
        const now = performance.now();
        if (rms < 0.01) {
          silentSinceRef.current ??= now;
          if (now - silentSinceRef.current > 4000) setSilent(true);
        } else {
          silentSinceRef.current = null;
          setSilent(false);
        }
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      elapsedRef.current = 0;
      setElapsed(0);
    } catch {
      setError('Your microphone is not available. You can write instead.');
    }
  }, [stopMeter]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    setRecording(false);
  }, []);

  /**
   * "Let it go" — nothing was ever uploaded, so there is nothing to delete.
   *
   * The words are held one screen longer than the decision, so a mis-tap is
   * recoverable. Releasing a thought should be a decision, never an accident.
   */
  const release = useCallback(() => {
    setReleasedFrom(stage === 'deciding' ? 'deciding' : 'capturing');
    setStage('released');
  }, [stage]);

  const bringItBack = useCallback(() => setStage(releasedFrom), [releasedFrom]);

  const leaveForGood = useCallback(() => {
    setText('');
    setAudio(null);
    chunksRef.current = [];
    router.push('/app');
  }, [router]);

  // Nothing here has been uploaded, so a closed tab is the one way to lose a
  // thought outright. Worth interrupting for.
  const unsaved =
    (text.trim().length > 0 || audio !== null) && stage !== 'saved' && stage !== 'released';
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  const keepPrivately = useCallback(async () => {
    if (!token || !key) return;
    setStage('saving');
    setError(null);
    try {
      const saved = audio
        ? await saveAudioThought(audio, { token, key, keyVersion })
        : await saveTextThought(text, { token, key, keyVersion });
      setSavedId(saved.id);
      setStage('saved');
    } catch {
      setError('That did not save. Nothing has left this device.');
      setStage('deciding');
    }
  }, [audio, text, token, key, keyVersion]);

  if (stage === 'saved') {
    return (
      <div className="flex flex-1 flex-col justify-center py-16">
        <h1 className="font-serif text-2xl text-ink">Saved, and only you can open it.</h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          It was encrypted on this device before it was stored. You control this memory.
        </p>
        <div className="mt-10 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => router.push(savedId ? `/vault/${savedId}` : '/vault')}
            className="rounded-xl bg-ink px-6 py-4 text-paper"
          >
            Open it
          </button>
          <button
            type="button"
            onClick={() => router.push('/app')}
            className="rounded-xl border border-field px-6 py-4 text-ink"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'released') {
    return (
      <div className="flex flex-1 flex-col justify-center py-16">
        <h1 className="font-serif text-2xl text-ink">Let go.</h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          It was never uploaded, so there is nothing left to delete. It is still on this screen,
          if you did not mean to.
        </p>
        <div className="mt-10 flex flex-col gap-3">
          <button
            type="button"
            onClick={leaveForGood}
            className="rounded-xl border border-transparent bg-ink px-6 py-4 text-paper"
          >
            Done
          </button>
          <button
            type="button"
            onClick={bringItBack}
            className="rounded-xl border border-field px-6 py-4 text-ink"
          >
            Bring it back
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'deciding' || stage === 'saving') {
    // Blueprint §11.3: the decision sheet, shown after capture rather than
    // saving everywhere automatically.
    return (
      <div className="flex flex-1 flex-col justify-center py-16">
        <h1 className="font-serif text-2xl text-ink">What do you want to do with this?</h1>
        <p role="alert" className="mt-4 text-sm text-ember empty:hidden">
          {error}
        </p>
        {audioUrl && (
          <audio controls src={audioUrl} className="mt-6 w-full">
            Your browser cannot play this recording.
          </audio>
        )}
        <div className="mt-10 flex flex-col gap-3">
          <button
            type="button"
            onClick={keepPrivately}
            disabled={stage === 'saving'}
            className="rounded-xl border border-transparent bg-ink px-6 py-4 text-paper disabled:cursor-not-allowed disabled:border-field disabled:bg-transparent disabled:text-ink-faint"
          >
            {stage === 'saving' ? 'Encrypting…' : 'Keep it privately'}
          </button>
          <button
            type="button"
            onClick={release}
            disabled={stage === 'saving'}
            className="rounded-xl border border-field px-6 py-4 text-ink"
          >
            Let it go
          </button>
        </div>
        <p className="mt-8 text-xs leading-relaxed text-ink-faint">
          Letting it go discards it here and now. Nothing has been uploaded yet, so there is
          nothing left to delete.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col py-8">
      {isVoice ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-8">
          <p className="font-mono text-4xl tabular-nums text-ink">
            {String(Math.floor(elapsed / 60)).padStart(2, '0')}:
            {String(elapsed % 60).padStart(2, '0')}
          </p>
          <p role="alert" className="text-sm text-ember empty:hidden">
            {error}
          </p>
          {recording && (
            <div className="flex w-full max-w-xs flex-col items-center gap-3">
              <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-line">
                <div
                  ref={meterRef}
                  className="h-full w-full origin-left scale-x-0 rounded-full bg-ember"
                />
              </div>
              {/* A silent meter is ambiguous; a muted microphone should say so. */}
              <p aria-live="polite" className="text-xs text-ember empty:hidden">
                {silent ? 'No sound is reaching the microphone.' : ''}
              </p>
            </div>
          )}
          {recording ? (
            <button
              type="button"
              onClick={stopRecording}
              className="size-28 rounded-full bg-ember text-paper"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              className="size-28 rounded-full bg-ink text-paper"
            >
              Talk
            </button>
          )}
          <p className="text-xs text-ink-faint">Recorded on this device. Nothing is sent yet.</p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          {guided && <p className="mb-4 font-serif text-lg text-ink-soft">{prompt}</p>}
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Say anything."
            autoFocus
            className="flex-1 resize-none border-none bg-transparent text-lg leading-relaxed text-ink outline-none placeholder:text-ink-faint"
          />
          <div className="flex gap-3 py-6">
            <button
              type="button"
              onClick={() => {
                track({
                  name: 'capture_completed',
                  captureType: 'text',
                  durationBucket: toDurationBucket(0),
                });
                setStage('deciding');
              }}
              disabled={text.trim().length === 0}
              className="rounded-xl border border-transparent bg-ink px-6 py-3 text-paper disabled:cursor-not-allowed disabled:border-field disabled:bg-transparent disabled:text-ink-faint"
            >
              Done
            </button>
            <button type="button" onClick={release} className="px-6 py-3 text-sm text-ink-faint">
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CapturePage() {
  return (
    <Shell screen="capture">
      <UnlockGate>
        <Suspense fallback={null}>
          <CaptureScreen />
        </Suspense>
      </UnlockGate>
    </Shell>
  );
}
