export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const audio = formData.get('audio') as Blob
    if (!audio) return new Response(JSON.stringify({ error: 'no audio' }), { status: 400 })

    const arrayBuffer = await audio.arrayBuffer()
    const mimeType = audio.type || 'audio/webm'

    const res = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&language=en', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
        'Content-Type': mimeType,
      },
      body: arrayBuffer,
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Deepgram error: ${res.status} ${err}`)
    }

    const data = await res.json()
    const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || ''
    return new Response(JSON.stringify({ transcript }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error(e)
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
}
