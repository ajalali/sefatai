'use client'

import { useState, useRef, useCallback, useEffect, useReducer } from 'react'
import Image from 'next/image'

// ─── State machine ────────────────────────────────────────────

type AppState = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'playing'

type Action =
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'TRANSCRIBED' }
  | { type: 'GOT_RESPONSE' }
  | { type: 'AUDIO_ENDED' }
  | { type: 'INTERRUPT' }
  | { type: 'ERROR' }

const TRANSITIONS: Record<AppState, Partial<Record<Action['type'], AppState>>> = {
  idle:         { START_RECORDING: 'recording' },
  recording:    { STOP_RECORDING: 'transcribing', ERROR: 'idle' },
  transcribing: { TRANSCRIBED: 'thinking', ERROR: 'idle' },
  thinking:     { GOT_RESPONSE: 'playing', ERROR: 'idle' },
  playing:      { AUDIO_ENDED: 'idle', INTERRUPT: 'idle' },
}

const STATUS_TEXT: Record<AppState, string> = {
  idle:         'tap to ask',
  recording:    'tap to stop',
  transcribing: 'transcribing...',
  thinking:     'searching sources...',
  playing:      'tap to stop',
}

function reducer(state: AppState, action: Action): AppState {
  const next = TRANSITIONS[state]?.[action.type]
  if (!next) return state
  return next
}

// ─── Component ────────────────────────────────────────────────

const THINKING_MESSAGES = [
  'searching sources...',
  'consulting texts...',
  'preparing answer...',
]

export default function Home() {
  const [appState, dispatch] = useReducer(reducer, 'idle')
  const [thinkingText, setThinkingText] = useState(THINKING_MESSAGES[0])
  const [transcript, setTranscript] = useState('')
  const [answer, setAnswer] = useState('')
  const [booting, setBooting] = useState(true)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const thinkingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const historyRef = useRef<{ role: string; content: string }[]>([])
  const welcomeDoneRef = useRef(false)
  const audioUnlockedRef = useRef(false)

  // Thinking messages cycling
  useEffect(() => {
    if (appState === 'thinking') {
      let i = 0
      setThinkingText(THINKING_MESSAGES[0])
      thinkingIntervalRef.current = setInterval(() => {
        i = (i + 1) % THINKING_MESSAGES.length
        setThinkingText(THINKING_MESSAGES[i])
      }, 2000)
    } else {
      if (thinkingIntervalRef.current) {
        clearInterval(thinkingIntervalRef.current)
        thinkingIntervalRef.current = null
      }
    }
  }, [appState])

  const statusText = appState === 'thinking' ? thinkingText : STATUS_TEXT[appState]

  // ─── Audio unlock (iOS) ───────────────────────────────────────
  const unlockAudio = async () => {
    if (audioUnlockedRef.current) return
    try {
      const audio = audioRef.current
      if (!audio) return
      audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'
      await audio.play()
      audio.pause()
      audio.src = ''
      audioUnlockedRef.current = true
    } catch { /* ignore */ }
  }

  // ─── Audio playback ───────────────────────────────────────────
  const stopAudio = () => {
    const a = audioRef.current
    if (a) { a.pause(); a.src = '' }
    dispatch({ type: 'INTERRUPT' })
  }

  const playAudio = (url: string): Promise<void> => {
    return new Promise((resolve) => {
      const a = audioRef.current
      if (!a) { resolve(); return }
      dispatch({ type: 'GOT_RESPONSE' })
      a.src = url
      a.onended = () => { dispatch({ type: 'AUDIO_ENDED' }); resolve() }
      a.onerror = () => { dispatch({ type: 'ERROR' }); resolve() }
      a.play().catch(() => { dispatch({ type: 'ERROR' }); resolve() })
    })
  }

  // ─── Recording ───────────────────────────────────────────────
  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      audioChunksRef.current = []
      setTranscript('')
      setAnswer('')
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.start(100)
      dispatch({ type: 'START_RECORDING' })
    } catch {
      dispatch({ type: 'ERROR' })
    }
  }

  const stopRecording = (): Promise<Blob> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder) { resolve(new Blob()); return }
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType })
        stopStream()
        resolve(blob)
      }
      recorder.stop()
      dispatch({ type: 'STOP_RECORDING' })
    })
  }

  // ─── Transcribe ───────────────────────────────────────────────
  const transcribeAudio = async (blob: Blob): Promise<string> => {
    const form = new FormData()
    form.append('audio', blob, 'audio.webm')
    const res = await fetch('/api/transcribe', { method: 'POST', body: form })
    if (!res.ok) throw new Error('transcription failed')
    const data = await res.json()
    return data.transcript || ''
  }

  // ─── Ask ──────────────────────────────────────────────────────
  const ask = useCallback(async (userInput: string, isWelcome = false) => {
    if (userInput && !isWelcome) {
      historyRef.current = [
        ...historyRef.current.slice(-5),
        { role: 'user', content: userInput },
      ]
    }
    try {
      const res = await fetch('/api/chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userInput, isWelcome, history: historyRef.current }),
      })
      if (!res.ok) throw new Error('chain failed')
      const spokenText = decodeURIComponent(res.headers.get('X-Spoken-Text') || '')
      const arrayBuffer = await res.arrayBuffer()
      const audioBlob = new Blob([arrayBuffer], { type: 'audio/mpeg' })
      if (spokenText) {
        setAnswer(spokenText)
        if (!isWelcome) {
          historyRef.current = [
            ...historyRef.current.slice(-5),
            { role: 'assistant', content: spokenText },
          ]
        }
      }
      const url = URL.createObjectURL(audioBlob)
      await playAudio(url)
    } catch (e) {
      console.error('ask error', e)
      dispatch({ type: 'ERROR' })
    }
  }, [])

  // ─── Boot ─────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      await new Promise(r => setTimeout(r, 2000))
      setBooting(false)
      if (!welcomeDoneRef.current) {
        welcomeDoneRef.current = true
        await ask('', true)
      }
    }
    init()
  }, [])

  // ─── Tap handler ──────────────────────────────────────────────
  const handleTap = async () => {
    if (appState === 'idle') await unlockAudio()
if (appState === 'transcribing' || appState === 'thinking') return
    if (appState === 'playing') {
      stopAudio()
      return
    }

    if (appState === 'recording') {
      const blob = await stopRecording()
      if (blob.size < 1000) {
        dispatch({ type: 'ERROR' })
        return
      }
      try {
        const text = await transcribeAudio(blob)
        if (!text.trim()) {
          dispatch({ type: 'ERROR' })
          return
        }
        setTranscript(text)
        dispatch({ type: 'TRANSCRIBED' })
        await ask(text, false)
      } catch {
        dispatch({ type: 'ERROR' })
      }
      return
    }

    await startRecording()
  }

  // ─── Boot screen ──────────────────────────────────────────────
  if (booting) {
    return (
      <main className="relative min-h-screen bg-stone-950 flex flex-col items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-b from-stone-950 via-amber-950/20 to-stone-950" />
        <div className="relative z-10 flex flex-col items-center gap-6">
          <Image
            src="/sefatailogo.png"
            alt="Sefatai"
            width={200}
            height={200}
            className="rounded-full shadow-[0_0_80px_rgba(217,119,6,0.5)]"
          />
          <p className="text-amber-400/60 text-xs tracking-widest uppercase animate-pulse">
            Loading with kavanah...
          </p>
        </div>
      </main>
    )
  }

  // ─── Main UI ──────────────────────────────────────────────────
  return (
    <main className="relative min-h-screen bg-stone-950 flex flex-col items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-stone-950 via-amber-950/20 to-stone-950" />

      <div className="relative z-10 flex flex-col items-center gap-6 px-6 max-w-md w-full">

        <p className="text-amber-400/50 text-xs tracking-widest uppercase">Voice Learning Companion</p>

        <button
          onClick={handleTap}
          className={`w-36 h-36 rounded-full border-2 flex items-center justify-center transition-all duration-500 ${
            appState === 'thinking'
              ? 'border-amber-300 bg-amber-900/20 animate-pulse shadow-[0_0_60px_rgba(217,119,6,0.5)]'
              : appState === 'recording'
              ? 'border-red-400 bg-red-900/30 shadow-[0_0_60px_rgba(220,38,38,0.5)]'
              : appState === 'playing'
              ? 'border-blue-400 bg-blue-900/20 shadow-[0_0_60px_rgba(96,165,250,0.4)] animate-pulse'
              : appState === 'transcribing'
              ? 'border-amber-300 bg-amber-900/20 animate-pulse shadow-[0_0_60px_rgba(217,119,6,0.3)]'
              : 'border-amber-400 bg-amber-900/20 shadow-[0_0_40px_rgba(217,119,6,0.3)] hover:bg-amber-800/20'
          }`}
        >
          <span className="text-4xl">🎙️</span>
        </button>

        <p className="text-amber-400/60 text-xs tracking-widest uppercase animate-pulse">
          {statusText}
        </p>

        {transcript && (
          <p className="text-amber-200/40 text-sm text-center italic">"{transcript}"</p>
        )}

        {answer && (
          <div className="bg-stone-900/60 border border-amber-900/40 rounded-2xl p-5 text-amber-100/80 text-sm leading-relaxed text-center max-h-64 overflow-y-auto">
            {answer}
          </div>
        )}

      </div>

      <audio ref={audioRef} className="hidden" />
    </main>
  )
}
