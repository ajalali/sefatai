'use client'

import { useState, useRef, useCallback } from 'react'

type AppState = 'idle' | 'loading' | 'recording' | 'playing'

const LOADING_MESSAGES = [
  'searching sources...',
  'consulting texts...',
  'preparing answer...',
]

export default function Home() {
  const [appState, setAppState] = useState<AppState>('idle')
  const [statusText, setStatusText] = useState('')
  const [transcript, setTranscript] = useState('')
  const [answer, setAnswer] = useState('')
  const [started, setStarted] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const loadingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const historyRef = useRef<{ role: string; content: string }[]>([])

  const setStatus = (state: AppState, text: string) => {
    setAppState(state)
    setStatusText(text)
  }

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  const startLoadingMessages = () => {
    let i = 0
    setStatus('loading', LOADING_MESSAGES[0])
    loadingIntervalRef.current = setInterval(() => {
      i = (i + 1) % LOADING_MESSAGES.length
      setStatusText(LOADING_MESSAGES[i])
    }, 2000)
  }

  const stopLoadingMessages = () => {
    if (loadingIntervalRef.current) {
      clearInterval(loadingIntervalRef.current)
      loadingIntervalRef.current = null
    }
  }

  const stopAudio = () => {
    const a = audioRef.current
    if (a) { a.pause(); a.src = '' }
    setAppState('idle')
  }

  const playAudio = (url: string): Promise<void> => {
    return new Promise((resolve) => {
      const a = audioRef.current
      if (!a) { resolve(); return }
      stopAudio()
      setStatus('playing', 'tap to stop')
      a.src = url
      a.onended = () => { setAppState('idle'); resolve() }
      a.onerror = () => { setAppState('idle'); resolve() }
      a.play().catch(() => resolve())
    })
  }

  const startRecording = async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      audioChunksRef.current = []
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.start(100)
      setStatus('recording', 'tap to stop')
      return true
    } catch {
      setStatus('idle', 'mic access needed')
      return false
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

  const transcribeAudio = async (blob: Blob): Promise<string> => {
    const form = new FormData()
    form.append('audio', blob, 'audio.webm')
    const res = await fetch('/api/transcribe', { method: 'POST', body: form })
    if (!res.ok) throw new Error('transcription failed')
    const data = await res.json()
    return data.transcript || ''
  }

  const ask = useCallback(async (userInput: string) => {
    startLoadingMessages()
    if (userInput) {
      historyRef.current = [
        ...historyRef.current.slice(-5),
        { role: 'user', content: userInput },
      ]
    }
    try {
      const res = await fetch('/api/chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userInput, history: historyRef.current }),
      })
      if (!res.ok) throw new Error('chain failed')
      const spokenText = decodeURIComponent(res.headers.get('X-Spoken-Text') || '')
      if (spokenText) setAnswer(spokenText)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      stopLoadingMessages()
      await playAudio(url)
    } catch {
      stopLoadingMessages()
      setStatus('idle', 'something went wrong')
    }
    setStatus('idle', 'tap to ask')
  }, [])

  const handleTap = async () => {
    if (appState === 'loading') return

    if (appState === 'playing') {
      stopAudio()
      setStatus('idle', 'tap to ask')
      return
    }

    if (appState === 'recording') {
      const blob = await stopRecording()
      if (blob.size < 1000) {
        setStatus('idle', 'tap to ask')
        return
      }
      setStatus('loading', 'transcribing...')
      try {
        const text = await transcribeAudio(blob)
        if (!text.trim()) {
          setStatus('idle', 'tap to ask')
          return
        }
        setTranscript(text)
        await ask(text)
      } catch {
        setStatus('idle', 'tap to ask')
      }
      return
    }

    await startRecording()
  }

  const handleStart = async () => {
    setStarted(true)
    setStatus('idle', 'tap to ask')
    await ask('Give me a short welcome and ask what I would like to learn today.')
  }

  return (
    <main className="relative min-h-screen bg-stone-950 flex flex-col items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-stone-950 via-amber-950/20 to-stone-950" />

      <div className="relative z-10 flex flex-col items-center gap-8 px-6 max-w-md w-full">

        <div className="text-center">
          <h1 className="text-3xl font-serif text-amber-200 tracking-widest">סֵפָתַי</h1>
          <p className="text-amber-400/50 text-xs tracking-widest uppercase mt-1">Sefatai</p>
        </div>

        {!started ? (
          <button
            onClick={handleStart}
            className="w-36 h-36 rounded-full border-2 border-amber-400 bg-amber-900/20 flex items-center justify-center hover:bg-amber-800/30 transition-all duration-500 shadow-[0_0_60px_rgba(217,119,6,0.3)]"
          >
            <span className="text-4xl">✡️</span>
          </button>
        ) : (
          <button
            onClick={handleTap}
            className={`w-36 h-36 rounded-full border-2 flex items-center justify-center transition-all duration-500 ${
              appState === 'loading'
                ? 'border-amber-300 bg-amber-900/20 animate-pulse shadow-[0_0_60px_rgba(217,119,6,0.5)]'
                : appState === 'recording'
                ? 'border-red-400 bg-red-900/30 shadow-[0_0_60px_rgba(220,38,38,0.5)]'
                : appState === 'playing'
                ? 'border-blue-400 bg-blue-900/20 shadow-[0_0_60px_rgba(96,165,250,0.4)] animate-pulse'
                : 'border-amber-400 bg-amber-900/20 shadow-[0_0_40px_rgba(217,119,6,0.3)] hover:bg-amber-800/20'
            }`}
          >
            <span className="text-4xl">🎙️</span>
          </button>
        )}

        {statusText && (
          <p className="text-amber-400/70 text-xs tracking-widest uppercase">{statusText}</p>
        )}

        {transcript && appState !== 'recording' && (
          <p className="text-amber-200/40 text-sm text-center italic">"{transcript}"</p>
        )}

        {answer && (
          <div className="bg-stone-900/60 border border-amber-900/40 rounded-2xl p-5 text-amber-100/80 text-sm leading-relaxed text-center">
            {answer}
          </div>
        )}

      </div>

      <audio ref={audioRef} className="hidden" />
    </main>
  )
}
