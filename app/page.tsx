'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Image from 'next/image'

type AppState = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'playing'

const THINKING_MESSAGES = [
  'searching sources...',
  'consulting texts...',
  'preparing answer...',
]

export default function Home() {
  const [appState, setAppState] = useState<AppState>('idle')
  const [statusText, setStatusText] = useState('tap to ask')
  const [transcript, setTranscript] = useState('')
  const [answer, setAnswer] = useState('')

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const thinkingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const historyRef = useRef<{ role: string; content: string }[]>([])
  // Use a ref for state so callbacks always see the latest value
  const stateRef = useRef<AppState>('idle')

  const setState = (s: AppState, text: string) => {
    stateRef.current = s
    setAppState(s)
    setStatusText(text)
  }

  // ─── Thinking messages ────────────────────────────────────────
  const startThinking = () => {
    let i = 0
    setState('thinking', THINKING_MESSAGES[0])
    thinkingIntervalRef.current = setInterval(() => {
      i = (i + 1) % THINKING_MESSAGES.length
      setStatusText(THINKING_MESSAGES[i])
    }, 2000)
  }

  const stopThinking = () => {
    if (thinkingIntervalRef.current) {
      clearInterval(thinkingIntervalRef.current)
      thinkingIntervalRef.current = null
    }
  }

  // ─── Audio ────────────────────────────────────────────────────
  const stopAudio = () => {
    const a = audioRef.current
    if (a) { a.pause(); a.src = '' }
    setState('idle', 'tap to ask')
  }

  const playAudio = (url: string): Promise<void> => {
    return new Promise((resolve) => {
      const a = audioRef.current
      if (!a) { setState('idle', 'tap to ask'); resolve(); return }
      stopAudio()
      setState('playing', 'tap to stop')
      a.src = url
      a.onended = () => { setState('idle', 'tap to ask'); resolve() }
      a.onerror = () => { setState('idle', 'tap to ask'); resolve() }
      a.play().catch((e) => {
        console.error('play error', e)
        setState('idle', 'tap to ask')
        resolve()
      })
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
      setState('recording', 'tap to stop')
    } catch {
      setState('idle', 'mic access needed')
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
  const ask = useCallback(async (userInput: string) => {
    startThinking()
    historyRef.current = [
      ...historyRef.current.slice(-5),
      { role: 'user', content: userInput },
    ]
    try {
      const res = await fetch('/api/chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userInput, history: historyRef.current }),
      })
      if (!res.ok) throw new Error('chain failed')
      const spokenText = decodeURIComponent(res.headers.get('X-Spoken-Text') || '')
      const arrayBuffer = await res.arrayBuffer()
      const audioBlob = new Blob([arrayBuffer], { type: 'audio/mpeg' })
      stopThinking()
      if (spokenText) {
        setAnswer(spokenText)
        historyRef.current = [
          ...historyRef.current.slice(-5),
          { role: 'assistant', content: spokenText },
        ]
      }
      const url = URL.createObjectURL(audioBlob)
      await playAudio(url)
    } catch (e) {
      console.error('ask error', e)
      stopThinking()
      setState('idle', 'something went wrong')
    }
  }, [])

  // ─── Tap handler ──────────────────────────────────────────────
  const handleTap = async () => {
    const s = stateRef.current

    if (s === 'transcribing' || s === 'thinking') return

    if (s === 'playing') {
      stopAudio()
      return
    }

    if (s === 'recording') {
      setState('transcribing', 'transcribing...')
      const blob = await stopRecording()
      if (blob.size < 1000) {
        setState('idle', 'tap to ask')
        return
      }
      try {
        const text = await transcribeAudio(blob)
        if (!text.trim()) {
          setState('idle', 'tap to ask')
          return
        }
        setTranscript(text)
        await ask(text)
      } catch {
        setState('idle', 'tap to ask')
      }
      return
    }

    // idle → record
    await startRecording()
  }

  // ─── UI ───────────────────────────────────────────────────────
  return (
    <main className="relative min-h-screen bg-stone-950 flex flex-col items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-stone-950 via-amber-950/20 to-stone-950" />

      <div className="relative z-10 flex flex-col items-center gap-6 px-6 max-w-md w-full">

        <Image
          src="/sefatailogo.png"
          alt="Sefatai"
          width={120}
          height={120}
          className="rounded-full shadow-[0_0_40px_rgba(217,119,6,0.4)] opacity-80"
        />

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
