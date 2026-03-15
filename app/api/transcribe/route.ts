export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const audio = formData.get('audio') as Blob
    if (!audio) return new Response(JSON.stringify({ error: 'no audio' }), { status: 400 })

    const arrayBuffer = await audio.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2)
    const mimeType = audio.type || 'audio/webm'
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'

    // Sample Torah/Talmud conversation as prompt — Whisper uses this to
    // recognize Hebrew, Aramaic, and mixed-language Torah study speech
    const whisperPrompt = `Jewish Torah and Talmud study session. The speaker mixes English with Hebrew and Aramaic words and complete phrases.
Examples of what the speaker might say:
"What does Rashi say on Bereshit aleph aleph?"
"How many times does asarah tefachim appear in the Gemara?"
"Kol Yisrael yesh lahem chelek b'olam haba — what is the source?"
"Explain the machlokes between Abaye and Rava on this sugya."
"What is the halacha l'maaseh regarding eruv in a reshut harabim?"
"Amar Rav Yosef, teku, kashya, uvda d'rav — these are common Aramaic terms."
"The Mishnah in Pirkei Avot says ben zoma omer, eizehu chacham."
"What does lo tachmod mean and how is it different from lo titaveh?"
"Explain bein hashmashot and the safek of Shabbat."
"The Rambam paskens in Hilchot Shabbat, perek aleph, halacha aleph."
Hebrew books: Bereshit, Shemot, Vayikra, Bamidbar, Devarim, Tehillim, Mishlei.
Aramaic terms: amar, teku, kashya, uvda, de'oraita, derabanan, gemara, sugya, masechet.`

    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    )
    const modelPart = Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
    )
    const langPart = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n`
    )
    const promptPart = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${whisperPrompt}\r\n`
    )
    const footer = Buffer.from(`--${boundary}--\r\n`)

    const body = Buffer.concat([header, buffer, modelPart, langPart, promptPart, footer])

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Whisper error: ${res.status} ${err}`)
    }

    const data = await res.json()
    const transcript = data?.text || ''
    return new Response(JSON.stringify({ transcript }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error(e)
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
}
