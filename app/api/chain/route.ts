export const runtime = 'nodejs'

import Anthropic from '@anthropic-ai/sdk'
import { SEFATAI_VOICE_ID, VOICE_SETTINGS, ELEVENLABS_MODEL } from '@/lib/voices'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function detectIntent(text: string): { needsHebcal: boolean; detectedRef: string | null } {
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
  return { needsHebcal, detectedRef }
}

async function getTextByRef(ref: string): Promise<string> {
  try {
    const encoded = encodeURIComponent(ref)
    const res = await fetch(`https://www.sefaria.org/api/v3/texts/${encoded}`)
    if (!res.ok) return ''
    const data = await res.json()
    const en = data?.versions?.find((v: any) => v.language === 'en')
    if (!en) return ''
    const text = Array.isArray(en.text) ? en.text.flat().join(' ') : en.text
    return text || ''
  } catch {
    return ''
  }
}

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

const SYSTEM_PROMPT = `You are Sefatai, a calm and knowledgeable Jewish learning companion.

Your role is to explain Jewish texts, prayers, holidays, and concepts in a clear, respectful, source-grounded way.

You are not a posek and do not issue binding halachic rulings. If asked for a practical ruling say: "For a practical ruling, please consult a qualified rabbi."

Rules:
- Give a short direct answer — maximum 2 sentences
- Never give more than 2 sentences under any circumstances
- When quoting Hebrew, preserve Hebrew script
- No markdown, no bullet points, no headers — spoken text only
- Cite sources naturally e.g. "Rashi says..."
- When calendar data is provided, use it directly to answer
- Never introduce yourself or give a welcome message — just answer the question`

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { userInput, history, locationId } = body

    const { needsHebcal, detectedRef } = detectIntent(userInput || '')

    let retrievedContext = ''

    if (detectedRef) {
      const text = await getTextByRef(detectedRef)
      if (text) retrievedContext += `\nSource text for ${detectedRef}:\n${text.slice(0, 1000)}`
    }

    if (needsHebcal) {
      const [shabbat, holidays, hebrewDate] = await Promise.all([
        getShabbatData(locationId || '5368361'),
        getHolidayData(),
        getHebrewDate(),
      ])
      if (shabbat) retrievedContext += `\nThis week's Shabbat and parasha data: ${shabbat}`
      if (holidays) retrievedContext += `\nUpcoming Jewish holidays: ${holidays}`
      if (hebrewDate) retrievedContext += `\nToday's Hebrew date: ${hebrewDate}`
    }

    const historyMessages = (history || []).map((h: any) => ({
      role: h.role as 'user' | 'assistant',
      content: h.content,
    }))

    const userMessage = `${userInput}${retrievedContext ? `\n\n[Retrieved data:${retrievedContext}]` : ''}`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: [...historyMessages, { role: 'user', content: userMessage }],
    })

    const spokenText = message.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim()

    const elevenRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${SEFATAI_VOICE_ID}/stream`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: spokenText,
          model_id: ELEVENLABS_MODEL,
          voice_settings: VOICE_SETTINGS,
        }),
      }
    )

    if (!elevenRes.ok) {
      const errText = await elevenRes.text()
      throw new Error(`ElevenLabs error: ${elevenRes.status} - ${errText}`)
    }

    return new Response(elevenRes.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'X-Spoken-Text': encodeURIComponent(spokenText),
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
