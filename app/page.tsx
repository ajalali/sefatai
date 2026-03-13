'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

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
    if (userInput) historyRef.current = [...historyRef.current.slice(-5), { role: 'user', content: userInput }]

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
      if (blob.size < 1000) { setStatus('idle', 'tap to ask'); return }
      setStatus('loading', 'transcribing...')
      try {
        const text = await transcribeAudio(blob)
        if (!text.trim()) { setStatus('idle', 'tap to ask'); return }
        setTranscript(text)
        await ask(text)
      } catch {
        setStatus('idle', 'tap to ask')
      }
      return
    }

    // idle → start
