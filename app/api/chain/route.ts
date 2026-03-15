export const runtime = 'nodejs'

import Anthropic from '@anthropic-ai/sdk'
import { SEFATAI_VOICE_ID, VOICE_SETTINGS, ELEVENLABS_MODEL } from '@/lib/voices'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Intent detection ─────────────────────────────────────────

function detectIntent(text: string): { needsHebcal: boolean; detectedRef: string | null; isRecitation: boolean } {
  const lower = text.toLowerCase()
  const calendarKeywords = [
    'parsha', 'parasha', 'shabbat', 'shabbos', 'candle', 'havdalah',
    'holiday', 'yom tov', 'rosh chodesh', 'hebrew date', 'jewish calendar',
    'this week', 'tonight', 'today', 'passover', 'pesach', 'sukkot',
    'rosh hashana', 'yom kippur', 'shavuot', 'purim', 'chanukah', 'hanukkah',
    'next holiday', 'when is', 'what holiday', 'lag baomer', 'tisha bav'
  ]
  const needsHebcal = calendarKeywords.some(k => lower.includes(k))
  const refMatch = text.match(/(?:Rashi on |Ramban on |Maimonides on )?(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Bereshit|Shemot|Vayikra|Bamidbar|Devarim|Berakhot|Shabbat|Psalms|Proverbs|Isaiah|Jeremiah)\s+\d+(?::\d+)?/i)
  const detectedRef = refMatch ? refMatch[0].replace(/\s+/g, '.').replace(':', '.') : null
  const isRecitation = /(recite|read out|read me|say|give me the verse|give me the text|give me the pasuk|full|whole|entire|complete|all of|psalm|tehillim|perek|chapter|parasha|portion|pasuk|possuk|verse|text of|words of)/i.test(lower)
  return { needsHebcal, detectedRef, isRecitation }
}

// ─── Sefaria ──────────────────────────────────────────────────

async function getTextByRef(ref: string): Promise<string> {
  try {
    const encoded = encodeURIComponent(ref)
    const res = await fetch(`https://www.sefaria.org/api/v3/texts/${encoded}`)
    if (!res.ok) return ''
    const data = await res.json()

    const heVersion = data?.versions?.find((v: any) => v.language === 'he')
    const enVersion = data?.versions?.find((v: any) => v.language === 'en')

    let heText = ''
    let enText = ''

    if (heVersion) {
      const raw = Array.isArray(heVersion.text) ? heVersion.text.flat() : [heVersion.text]
      heText = raw.filter(Boolean).join('\n')
    }

    if (enVersion) {
      const raw = Array.isArray(enVersion.text) ? enVersion.text.flat() : [enVersion.text]
      enText = raw.filter(Boolean).join('\n')
    }

    if (heText && enText) return `Hebrew:\n${heText}\n\nEnglish:\n${enText}`
    if (heText) return heText
    if (enText) return enText
    return ''
  } catch {
    return ''
  }
}

// ─── Hebcal ───────────────────────────────────────────────────

async function getShabbatData(geonameid = '5368361'): Promise<string> {
  try {
    const res = await fetch(`https://www.hebcal.com/shabbat?cfg=json&geonameid=${geonameid}&M=on&leyning=on`)
    if (!res.ok) return ''
    const data = await res.json()
    const items = data?.items?.map((i: any) =>
      `${i.category}: ${i.title}${i.date ? ' on ' + i.date : ''}`
    ).join('. ')
    return items || ''
  } catch {
    return ''
  }
}

async function getHolidayData(): Promise<string> {
  try {
    const now = new Date()
    const year = now.getFullYear()
    const res = await fetch(
      `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&mod=on&nx=on&year=${year}&month=x&tz=America/Los_Angeles&locale=en&c=on&geo=geoname&geonameid=5368361`
    )
    if (!res.ok) return ''
    const data = await res.json()
    const upcoming = data?.items?.filter((i: any) => {
      if (!i.date) return false
      return new Date(i.date) >= now
    }).slice(0, 10).map((i: any) => `${i.title} on ${i.date}`).join(', ')
    return upcoming || ''
  } catch {
    return ''
  }
}

async function getHebrewDate(): Promise<string> {
  try {
    const now = new Date()
    const res = await fetch(
      `https://www.hebcal.com/converter?cfg=json&gy=${now.getFullYear()}&gm=${now.getMonth() + 1}&gd=${now.getDate()}&g2h=1`
    )
    if (!res.ok) return ''
    const data = await res.json()
    return data?.hdate || ''
  } catch {
    return ''
  }
}

// ─── Text chunking ────────────────────────────────────────────

type Chunk = { text: string; lang: 'he' | 'en' }

function chunkByLanguage(text: string): Chunk[] {
  const parts = text.split(/(\s*[\u0590-\u05FF\uFB1D-\uFB4F][\u0590-\u05FF\uFB1D-\uFB4F\s]*\s*)/)
  const chunks: Chunk[] = []

  for (const part of parts) {
    if (!part.trim()) continue
    const isHebrew = /[\u0590-\u05FF\uFB1D-\uFB4F]/.test(part)
    const lang = isHebrew ? 'he' : 'en'
    if (chunks.length > 0 && chunks[chunks.length - 1].lang === lang) {
      chunks[chunks.length - 1].text += part
    } else {
      chunks.push({ text: part, lang })
    }
  }

  return chunks.filter(c => c.text.trim().length > 0)
}

// ─── ElevenLabs TTS per chunk ─────────────────────────────────

async function ttsChunk(text: string, lang: 'he' | 'en'): Promise<ArrayBuffer> {
  const body: any = {
    text,
    model_id: ELEVENLABS_MODEL,
    voice_settings: VOICE_SETTINGS,
  }
  if (lang === 'he') body.language_code = 'he'

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${SEFATAI_VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY!,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify(body),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`ElevenLabs error: ${res.status} - ${err}`)
  }

  return res.arrayBuffer()
}

// ─── Stitch audio buffers ─────────────────────────────────────

function stitchAudio(buffers: ArrayBuffer[]): ArrayBuffer {
  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const buf of buffers) {
    result.set(new Uint8Array(buf), offset)
    offset += buf.byteLength
  }
  return result.buffer
}

// ─── System prompt ────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Sefatai, a calm, warm, and deeply knowledgeable Jewish learning companion with expertise across Torah, Talmud, halacha, Jewish philosophy, and the full range of Jewish tradition — Ashkenazi, Sephardi, and Mizrahi.

Your role is to teach, explain, and illuminate Jewish texts, laws, concepts, prayers, and traditions with clarity and depth.

How you answer:
- Lead with the Torah or Talmudic source when relevant
- Cite commentators naturally: Rashi, Rambam, Shulchan Aruch, Mishnah Berurah, Ben Ish Chai, Kaf HaChaim, etc.
- When quoting Hebrew or Aramaic, ALWAYS include full nikud (vowel marks) so text-to-speech pronounces correctly — e.g. צַלְמָוֶת not צלמות, שְׁמַע not שמע
- Speak like a knowledgeable chavruta partner — direct, warm, intellectually alive
- For regular questions: maximum 3 sentences
- For recitation requests (recite, read, say, full psalm, full chapter, give me the verse): recite the COMPLETE text in full with full nikud on every word — do not cut off or summarize
- No markdown, no bullet points, no headers — spoken text only
- When reciting multiple verses, put each verse on its own line

On halachic questions:
- Answer with the relevant sources and how the mainstream poskim rule
- Share the Sephardic/Mizrahi ruling when relevant
- End with a brief natural caveat such as "though for your specific situation, best to ask your rav"
- Never refuse to engage with halachic questions — you are learned and helpful

On calendar questions:
- Use the retrieved calendar data to give precise current answers

Never introduce yourself. Never give a welcome message. Just answer.`

// ─── Main handler ─────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { userInput, history, locationId } = body

    const { needsHebcal, detectedRef, isRecitation } = detectIntent(userInput || '')

    let retrievedContext = ''
    const sources: { label: string; url?: string }[] = []

    if (detectedRef) {
      const text = await getTextByRef(detectedRef)
      if (text) {
        retrievedContext += `\nSource text for ${detectedRef}:\n${text.slice(0, isRecitation ? 5000 : 1000)}`
        sources.push({
          label: detectedRef.replace(/\./g, ' '),
          url: `https://www.sefaria.org/${detectedRef}`
        })
      }
    }

    if (needsHebcal) {
      const [shabbat, holidays, hebrewDate] = await Promise.all([
        getShabbatData(locationId || '5368361'),
        getHolidayData(),
        getHebrewDate(),
      ])
      if (shabbat) {
        retrievedContext += `\nThis week's Shabbat and parasha data: ${shabbat}`
        sources.push({ label: 'Hebcal — Jewish Calendar', url: 'https://www.hebcal.com' })
      }
      if (holidays) retrievedContext += `\nUpcoming Jewish holidays: ${holidays}`
      if (hebrewDate) retrievedContext += `\nToday's Hebrew date: ${hebrewDate}`
    }

    const historyMessages = (history || []).map((h: any) => ({
      role: h.role as 'user' | 'assistant',
      content: h.content,
    }))

    const userMessage = `${userInput}${retrievedContext ? `\n\n[Retrieved data:${retrievedContext}]` : ''}`

    // ─── Claude ───────────────────────────────────────────────
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: isRecitation ? 1500 : 200,
      system: SYSTEM_PROMPT,
      messages: [...historyMessages, { role: 'user', content: userMessage }],
    })

    const spokenText = message.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim()

    sources.push({ label: 'Claude (Anthropic)' })

    // ─── Chunk + parallel TTS ─────────────────────────────────
    const chunks = chunkByLanguage(spokenText)

    let stitched: ArrayBuffer
    if (chunks.length === 1 && chunks[0].lang === 'en') {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${SEFATAI_VOICE_ID}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': process.env.ELEVENLABS_API_KEY!,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
          },
          body: JSON.stringify({
            text: spokenText,
            model_id: ELEVENLABS_MODEL,
            voice_settings: VOICE_SETTINGS,
          }),
        }
      )
      if (!res.ok) throw new Error(`ElevenLabs error: ${res.status}`)
      stitched = await res.arrayBuffer()
    } else {
      const audioBuffers = await Promise.all(
        chunks.map(chunk => ttsChunk(chunk.text, chunk.lang))
      )
      stitched = stitchAudio(audioBuffers)
    }

    return new Response(stitched, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'X-Spoken-Text': encodeURIComponent(spokenText),
        'X-Sources': encodeURIComponent(JSON.stringify(sources)),
      },
    })
  } catch (err) {
    console.error('Sefatai chain error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
