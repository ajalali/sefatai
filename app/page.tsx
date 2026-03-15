'use client'

import { useState, useRef, useCallback } from 'react'
import Image from 'next/image'

const MAX_HISTORY = 6

const LOADING_MESSAGES = [
  'searching sources...',
  'consulting texts...',
  'preparing answer...',
]

type AppState = 'idle' | 'loading' | 'playing' | 'recording'
type Source = { label: string; url?: string }

// ─── Debug (commented out — uncomment to re-enable) ───────────
// const debugLines: string[] = []
// function addDebug(msg: string) {
//   const t = new Date().toLocaleTimeString()
//   debugLines.unshift(`${t} ${msg}`)
//   if (debugLines.length > 30) debugLines.pop()
// }
// function DebugLog() {
//   const [lines, setLines] = useState<string[]>([])
//   useEffect(() => {
//     const interval = setInterval(() => setLines([...debugLines]), 300)
//     return () => clearInterval(interval)
//   }, [])
//   return (
//     <div className="fixed bottom-0 left-0 right-0 z-50 bg-black/95 text-green-400 text-xs font-mono p-2 max-h-40 overflow-y-auto border-t border-green-900">
//       {lines.map((l, i) => <div key={i}>{l}</div>)}
//     </div>
//   )
// }

export default function Home() {
  const [appState, setAppState] = useState<AppState>('idle')
  const [started, setStarted] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [transcript, setTranscript] = useState('')
  const [answer, setAnswer] = useState('')
  const [sources, setSources] = useState<Source[]>([])

  const historyRef = useRef<{ role: string; content: string }[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const loadingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  const setStatus = (s: AppState, text: string) => {
    setAppState(s)
    setStatusText(text)
  }

  const getMicStream = async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      return stream
    } catch {
      setStatus('idle', 'mic access needed')
      return null
    }
  }

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    audioContextRef.current?.close()
    audioContextRef.current = null
  }

  const startRecording = async (): Promise<boolean> => {
    const stream = await getMicStream()
    if (!stream) return false
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
  }

  const stopRecording = (): Promise<Blob> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder) { resolve(new Blob()); return }
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(audioChunksRef.current, { type: mimeType })
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
    if (!res.ok) throw new Error(`transcribe ${res.status}`)
    const data = await res.json()
    return data.transcript || ''
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
      a.play().catch((e) => { console.error('play error', e); resolve() })
    })
  }

  const startLoadingMessages = () => {
    stopLoadingMessages()
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

  const addToHistory = (role: string, content: string) => {
    historyRef.current = [
      ...historyRef.current.slice(-(MAX_HISTORY - 1)),
      { role, content },
    ]
  }

  const speak = useCallback(async (userInput: string) => {
    stopAudio()
    startLoadingMessages()
    addToHistory('user', userInput)

    try {
      const res = await fetch('/api/chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userInput, history: historyRef.current }),
      })
      if (!res.ok) throw new Error(`API ${res.status}`)
      const spokenText = decodeURIComponent(res.headers.get('X-Spoken-Text') || '')
      const rawSources = res.headers.get('X-Sources')
      if (rawSources) {
        try { setSources(JSON.parse(decodeURIComponent(rawSources))) } catch { setSources([]) }
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      stopLoadingMessages()
      if (spokenText) {
        setAnswer(spokenText)
        addToHistory('assistant', spokenText)
      }
      await playAudio(url)
    } catch (e) {
      console.error('speak error', e)
      stopLoadingMessages()
    }
    setStatus('idle', 'tap to ask')
  }, [])

  const handleMicTap = async () => {
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
      let text = ''
      try {
        text = await transcribeAudio(blob)
      } catch (e) {
        console.error('transcribe error', e)
        setStatus('idle', 'tap to ask')
        return
      }
      if (!text.trim()) {
        setStatus('idle', 'tap to ask')
        return
      }
      setTranscript(text)
      await speak(text)
      return
    }

    setTranscript('')
    setAnswer('')
    setSources([])
    await startRecording()
  }

  const handleStart = () => {
    setStarted(true)
    setStatus('idle', 'tap to ask')
  }

  const handleMore = () => {
    speak('Give me more — either recite more of the same text, or go deeper on the same concept.')
  }

  return (
    <main className="relative min-h-screen bg-stone-950 flex flex-col items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-stone-950 via-amber-950/20 to-stone-950" />

      <div className="relative z-10 flex flex-col items-center gap-6 px-6 max-w-md w-full">

        <div className="text-center">
          <h1 className="text-3xl font-serif text-amber-200 tracking-widest">סֵפָתַי</h1>
          <p className="text-amber-400/50 text-xs tracking-widest uppercase mt-1">Voice Learning Companion</p>
        </div>

        {!started ? (
          <>
            <p className="text-amber-400/60 text-xs tracking-widest uppercase animate-pulse">tap to begin</p>
            <button
              onClick={handleStart}
              className="w-36 h-36 rounded-full border-2 border-amber-400 overflow-hidden hover:opacity-90 transition-all duration-500 shadow-[0_0_60px_rgba(217,119,6,0.4)]"
            >
              <Image
                src="/sefatailogo.png"
                alt="Sefatai"
                width={144}
                height={144}
                className="w-full h-full object-cover"
              />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleMicTap}
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

            {statusText && (
              <p className="text-amber-400/60 text-xs tracking-widest uppercase animate-pulse">
                {statusText}
              </p>
            )}

            {transcript && appState !== 'recording' && (
              <p className="text-amber-200/40 text-sm text-center italic">"{transcript}"</p>
            )}

            {answer && (
              <div className="bg-stone-900/60 border border-amber-900/40 rounded-2xl p-5 text-amber-100/80 text-sm leading-relaxed text-center max-h-64 overflow-y-auto whitespace-pre-line">
                {answer}
              </div>
            )}

            {answer && appState === 'idle' && (
              <button
                onClick={handleMore}
                className="text-amber-400/50 hover:text-amber-300 text-xs uppercase tracking-widest transition-colors border border-amber-900/40 rounded-full px-4 py-1"
              >
                + more
              </button>
            )}

            {sources.length > 0 && (
              <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
                <span className="text-stone-600 text-xs w-full text-center uppercase tracking-widest mb-1">sources</span>
                {sources.map((s, i) => (
                  s.url ? (
                    
                      key={i}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400/60 hover:text-blue-300 text-xs tracking-wide underline underline-offset-2 transition-colors"
                    >
                      {s.label}
                    </a>
                  ) : (
                    <span key={i} className="text-stone-600 text-xs tracking-wide">
                      {s.label}
                    </span>
                  )
                ))}
              </div>
            )}
          </>
        )}

      </div>

      {/* <DebugLog /> */}
      <audio ref={audioRef} className="hidden" />
    </main>
  )
}
