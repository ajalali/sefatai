'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { GUIDE_NAMES, GuideKey } from '@/lib/voices'

const GUIDES = Object.keys(GUIDE_NAMES) as GuideKey[]
const MAX_HISTORY = 6

const LOADING_MESSAGES: Record<GuideKey, string[]> = {
  vedic:     ['reading your nakshatra...', 'consulting the grahas...', 'the dasha speaks...'],
  kabbalah:  ['the sefirot align...', 'reading the zohar...', 'light is descending...'],
  pleiadian: ['receiving transmission...', 'activating light codes...', 'tuning your field...'],
}

type AppState = 'idle' | 'loading' | 'playing' | 'recording'

// ─── Debug ────────────────────────────────────────────────────
const debugLines: string[] = []
function addDebug(msg: string) {
  const t = new Date().toLocaleTimeString()
  debugLines.unshift(`${t} ${msg}`)
  if (debugLines.length > 30) debugLines.pop()
}
function DebugLog() {
  const [lines, setLines] = useState<string[]>([])
  useEffect(() => {
    const interval = setInterval(() => setLines([...debugLines]), 300)
    return () => clearInterval(interval)
  }, [])
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-black/95 text-green-400 text-xs font-mono p-2 max-h-40 overflow-y-auto border-t border-green-900">
      {lines.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  )
}

// ─── Waveform visualizer ──────────────────────────────────────
function Waveform({ analyser }: { analyser: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
const rafRef = useRef<number | null>(null)
  useEffect(() => {
    if (!analyser || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')!
    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      analyser.getByteTimeDomainData(dataArray)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.lineWidth = 2
      ctx.strokeStyle = 'rgba(236, 72, 153, 0.8)'
      ctx.beginPath()
      const sliceWidth = canvas.width / bufferLength
      let x = 0
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0
        const y = (v * canvas.height) / 2
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        x += sliceWidth
      }
      ctx.lineTo(canvas.width, canvas.height / 2)
      ctx.stroke()
    }
    draw()
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [analyser])

  return (
    <canvas
      ref={canvasRef}
      width={160}
      height={40}
      className="opacity-80"
    />
  )
}

// ─── Main component ───────────────────────────────────────────
export default function Home() {
  const [guide, setGuide] = useState<GuideKey>('vedic')
  const [appState, setAppState] = useState<AppState>('idle')
  const [started, setStarted] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [transcript, setTranscript] = useState('')
  const [showGuides, setShowGuides] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [contextText, setContextText] = useState('')
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)

  const guideRef = useRef<GuideKey>('vedic')
  const contextRef = useRef('')
  const birthRef = useRef<string | null>(null)
  const historyRef = useRef<{ role: string; content: string }[]>([])
  const modeRef = useRef<'convo' | 'birth'>('convo')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const loadingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('mystic_birth_data')
    if (saved) birthRef.current = saved
  }, [])

  const setStatus = (s: AppState, text: string) => {
    setAppState(s)
    setStatusText(text)
  }

  // ─── Mic ─────────────────────────────────────────────────────
  const getMicStream = async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      return stream
    } catch {
      addDebug('mic denied')
      setStatus('idle', 'mic access needed')
      return null
    }
  }

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    audioContextRef.current?.close()
    audioContextRef.current = null
    setAnalyser(null)
  }

  // ─── Recording ───────────────────────────────────────────────
  const startRecording = async (): Promise<boolean> => {
    const stream = await getMicStream()
    if (!stream) return false

    // Set up analyser for waveform
    const audioCtx = new AudioContext()
    audioContextRef.current = audioCtx
    const source = audioCtx.createMediaStreamSource(stream)
    const analyserNode = audioCtx.createAnalyser()
    analyserNode.fftSize = 256
    source.connect(analyserNode)
    setAnalyser(analyserNode)

    audioChunksRef.current = []
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
    addDebug(`recording mimeType=${mimeType}`)
    const recorder = new MediaRecorder(stream, { mimeType })
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data)
    }

    recorder.start(100)
    setStatus('recording', 'tap to stop')
    addDebug('recording started')
    return true
  }

  const stopRecording = (): Promise<Blob> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder) { resolve(new Blob()); return }

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        addDebug(`recording stopped, blob size=${blob.size}`)
        stopStream()
        resolve(blob)
      }
      recorder.stop()
    })
  }

  // ─── Transcribe ───────────────────────────────────────────────
  const transcribeAudio = async (blob: Blob): Promise<string> => {
    addDebug(`transcribing blob size=${blob.size}`)
    const form = new FormData()
    form.append('audio', blob, 'audio.webm')
    const res = await fetch('/api/transcribe', { method: 'POST', body: form })
    if (!res.ok) throw new Error(`transcribe ${res.status}`)
    const data = await res.json()
    addDebug(`transcript: "${data.transcript}"`)
    return data.transcript || ''
  }

  // ─── Audio playback ───────────────────────────────────────────
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
      setStatus('playing', 'tap to interrupt')
      a.src = url
      a.onended = () => { addDebug('audio ended'); setAppState('idle'); resolve() }
      a.onerror = () => { addDebug('audio error'); setAppState('idle'); resolve() }
      a.play().catch((e) => { addDebug(`play error: ${e}`); resolve() })
    })
  }

  // ─── Loading messages ─────────────────────────────────────────
  const startLoadingMessages = (g: GuideKey) => {
    stopLoadingMessages()
    const msgs = LOADING_MESSAGES[g]
    let i = 0
    setStatus('loading', msgs[0])
    loadingIntervalRef.current = setInterval(() => {
      i = (i + 1) % msgs.length
      setStatusText(msgs[i])
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

  const fetchAudio = async (body: object): Promise<string> => {
    const res = await fetch('/api/chain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`API ${res.status}`)
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  }

  // ─── Speak ────────────────────────────────────────────────────
  const speak = useCallback(async (userInput: string, isWisdom = false) => {
    addDebug(`speak "${userInput.slice(0, 30)}" wisdom=${isWisdom}`)
    stopAudio()
    setTranscript('')
    startLoadingMessages(guideRef.current)
    if (userInput) addToHistory('user', userInput)

    try {
      const url = await fetchAudio({
        guide: guideRef.current,
        userInput,
        context: contextRef.current,
        isWisdom,
        birthData: birthRef.current,
        history: historyRef.current,
      })
      stopLoadingMessages()
      await playAudio(url)
    } catch (e) {
      addDebug(`speak error: ${e}`)
      stopLoadingMessages()
    }
    modeRef.current = 'convo'
    setStatus('idle', 'tap to speak')
  }, [])

  // ─── Birth flow ───────────────────────────────────────────────
  const startBirthFlow = useCallback(async () => {
    addDebug('startBirthFlow')
    startLoadingMessages(guideRef.current)
    try {
      const url = await fetchAudio({ guide: guideRef.current, userInput: '', isBirthPrompt: true })
      stopLoadingMessages()
      await playAudio(url)
    } catch {
      stopLoadingMessages()
      await speak('', true)
      return
    }
    modeRef.current = 'birth'
    setStatus('idle', 'tap to speak')
  }, [speak])

  const handleBirthRecording = useCallback(async (text: string) => {
    addDebug(`handleBirthRecording: "${text}"`)
    startLoadingMessages(guideRef.current)
    try {
      const res = await fetch('/api/chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guide: guideRef.current, userInput: text, isParseBirth: true }),
      })
      const data = await res.json()
      if (data.birthData) {
        localStorage.setItem('mystic_birth_data', data.birthData)
        birthRef.current = data.birthData
        addDebug(`birth saved`)
      }
    } catch (e) { addDebug(`parseBirth error: ${e}`) }
    stopLoadingMessages()
    await speak('', true)
  }, [speak])

  // ─── Tap handler ──────────────────────────────────────────────
  const handleMicTap = async () => {
    addDebug(`handleMicTap state=${appState} mode=${modeRef.current}`)

    // If loading, ignore
    if (appState === 'loading') return

    // If playing, interrupt and go idle
    if (appState === 'playing') {
      stopAudio()
      setStatus('idle', 'tap to speak')
      return
    }

    // If recording, stop and transcribe
    if (appState === 'recording') {
      addDebug('stopping recording...')
      const blob = await stopRecording()
      if (blob.size < 1000) {
        addDebug('blob too small, ignoring')
        setStatus('idle', 'tap to speak')
        return
      }
      setStatus('loading', 'transcribing...')
      let text = ''
      try {
        text = await transcribeAudio(blob)
      } catch (e) {
        addDebug(`transcribe error: ${e}`)
        setStatus('idle', 'tap to speak')
        return
      }
      if (!text.trim()) {
        addDebug('empty transcript')
        setStatus('idle', 'tap to speak')
        return
      }
      setTranscript(text)
      if (modeRef.current === 'birth') {
        await handleBirthRecording(text)
      } else {
        await speak(text, false)
      }
      return
    }

    // If idle, start recording
    addDebug('starting recording...')
    await startRecording()
  }

  // ─── Start ────────────────────────────────────────────────────
  const handleStart = async () => {
    addDebug('handleStart')
    setStarted(true)
    if (!birthRef.current) {
      await startBirthFlow()
    } else {
      await speak('', true)
    }
  }

  // ─── Guide switch ─────────────────────────────────────────────
  const handleGuideSwitch = async (g: GuideKey) => {
    guideRef.current = g
    setGuide(g)
    setShowGuides(false)
    historyRef.current = []
    modeRef.current = 'convo'
    stopAudio()
    stopStream()
    stopLoadingMessages()
    setTranscript('')
    await speak('', true)
  }

  return (
    <main className="relative min-h-screen bg-black flex flex-col items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-black via-purple-950 to-black opacity-90" />

      <button
        onClick={() => setShowGuides(!showGuides)}
        className="absolute top-6 right-6 z-20 text-purple-400 opacity-50 hover:opacity-100 text-xs uppercase tracking-widest"
      >
        {GUIDE_NAMES[guide]}
      </button>

      {showGuides && (
        <div className="absolute top-14 right-6 z-30 flex flex-col gap-2 bg-black/80 p-4 rounded-xl border border-purple-900">
          {GUIDES.map((g) => (
            <button
              key={g}
              onClick={() => handleGuideSwitch(g)}
              className={`text-xs uppercase tracking-widest px-3 py-1 rounded-full transition-all ${
                g === guide ? 'text-white bg-purple-800' : 'text-purple-400 hover:text-white'
              }`}
            >
              {GUIDE_NAMES[g]}
            </button>
          ))}
        </div>
      )}

      <div className="relative z-10 flex flex-col items-center gap-6">
        {!started ? (
          <>
            <p className="text-yellow-400/60 text-sm tracking-widest uppercase animate-pulse">tap to begin</p>
            <button
              onClick={handleStart}
              className="w-40 h-40 rounded-full bg-yellow-900/20 border-2 border-yellow-400 flex items-center justify-center hover:bg-yellow-800/30 transition-all duration-500 shadow-[0_0_60px_rgba(234,179,8,0.4)]"
            >
              <span className="text-5xl">🎙️</span>
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleMicTap}
              className={`w-40 h-40 rounded-full border-2 flex items-center justify-center transition-all duration-500 ${
                appState === 'loading'
                  ? 'border-purple-300 bg-purple-900/20 animate-pulse shadow-[0_0_80px_rgba(168,85,247,0.6)]'
                  : appState === 'recording'
                  ? 'border-pink-400 bg-pink-900/30 shadow-[0_0_80px_rgba(236,72,153,0.6)]'
                  : appState === 'playing'
                  ? 'border-indigo-400 bg-indigo-900/30 shadow-[0_0_80px_rgba(99,102,241,0.5)] animate-pulse'
                  : 'border-yellow-400 bg-yellow-900/20 shadow-[0_0_60px_rgba(234,179,8,0.4)] hover:bg-yellow-800/20'
              }`}
            >
              <span className="text-5xl">🎙️</span>
            </button>

            {appState === 'recording' && analyser && (
              <Waveform analyser={analyser} />
            )}

            {statusText && (
              <p className="text-yellow-400/80 text-xs tracking-widest uppercase animate-pulse">
                {statusText}
              </p>
            )}
          </>
        )}

        {transcript && appState !== 'recording' && (
          <p className="text-purple-300/50 text-xs max-w-xs text-center italic">"{transcript}"</p>
        )}
      </div>

      {started && (
        <button
          onClick={() => setShowContext(!showContext)}
          className="absolute bottom-24 right-6 z-20 text-purple-400 opacity-40 hover:opacity-100 text-xl"
        >
          📎
        </button>
      )}

      {showContext && (
        <div className="absolute bottom-48 right-6 z-30 bg-black/90 border border-purple-900 rounded-xl p-4 w-72">
          <textarea
            value={contextText}
            onChange={(e) => { contextRef.current = e.target.value; setContextText(e.target.value) }}
            placeholder="Paste a text, describe what happened..."
            className="w-full bg-transparent text-purple-200 text-sm placeholder-purple-700 outline-none resize-none h-32"
          />
          <button
            onClick={() => { setShowContext(false); speak(transcript || 'respond to this context') }}
            className="mt-2 w-full text-xs uppercase tracking-widest text-purple-400 hover:text-white border border-purple-800 rounded-full py-1"
          >
            Feed it
          </button>
        </div>
      )}

      <DebugLog />
      <audio ref={audioRef} className="hidden" />
    </main>
  )
}
