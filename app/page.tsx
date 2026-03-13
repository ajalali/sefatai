'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Image from 'next/image'

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
  const [booting, setBooting] = useState(true)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const loadingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const historyRef = useRef<{ role: string; content: string }[]>([])
  const welcomeDoneRef = useRef(false)

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
      a.onerror = (e) => { console.error('audio error', e); setAppState('idle'); resolve() }
      a.play().catch((e) => { console.error('play error', e); setAppState('idle'); resolve() })
    })
  }

  const startRecording = async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      audioChunksRef.current = []
      // Clear previous transcript and answer when starting new question
      setTranscript('')
      setAnswer('')
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

  const ask = useCallback(async (userInput: string, isWelcome = false) => {
    startLoadingMessages()
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
        body: JSON.stringify({
          userInput,
          isWelcome,
          history: historyRef.current,
        }),
      })
      if (!res.ok) throw new Error('chain failed')
      const spokenText = decodeURIComponent(res.headers.get('X-Spoken-Text') || '')
      const arrayBuffer = await res.arrayBuffer()
      const audioBlob = new Blob([arrayBuffer], { type: 'audio/mpeg' })
      if (spokenText) setAnswer(spokenText)
      const url = URL.createObjectURL(audioBlob)
      stopLoadingMessages()
      await playAudio(url)
    } catch (e) {
      console.error('ask error', e)
      stopLoadingMessages()
      setStatus('idle', 'something went wrong')
    }
    setStatus('idle', 'tap to ask')
  }, [])

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
        await ask(text, false)
      } catch {
        setStatus('idle', 'tap to ask')
      }
      return
    }

    await startRecording()
  }

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

  return (
    <main className="relative min-h-screen bg-stone-950 flex flex-col items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-stone-950 via-amber-950/20 to-stone-950" />

      <div className="relative z-10 flex flex-col items-center gap-6 px-6 max-w-md w-full">

        <p className="text-amber-400/50 text-xs tracking-widest uppercase">Voice Learning Companion</p>

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

        <p className="text-amber-400/60 text-xs tracking-widest uppercase animate-pulse">
          {statusText || 'tap to ask'}
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
