export const runtime = 'nodejs'

import Anthropic from '@anthropic-ai/sdk'
import { SEFATAI_VOICE_ID, VOICE_SETTINGS, ELEVENLABS_MODEL } from '@/lib/voices'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Intent detection ─────────────────────────────────────────

function detectIntent(text: string): { needsHebcal: boolean; detectedRef: string | null; isRecitation: boolean; isMore: boolean } {
  const lower = text.toLowerCase()

  const calendarKeywords = [
    'parsha', 'parasha', 'shabbat', 'shabbos', 'candle', 'havdalah',
    'holiday', 'yom tov', 'rosh chodesh', 'hebrew date', 'jewish calendar',
    'this week', 'tonight', 'today', 'passover', 'pesach', 'sukkot',
    'rosh hashana', 'yom kippur', 'shavuot', 'purim', 'chanukah', 'hanukkah',
    'next holiday', 'when is', 'what holiday', 'lag baomer', 'tisha bav'
  ]
  const needsHebcal = calendarKeywords.some(k => lower.includes(k))
  const isRecitation = /(recite|read out|read me|say|give me the verse|give me the text|give me the pasuk|full|whole|entire|complete|all of|psalm|tehillim|perek|chapter|parasha|portion|pasuk|possuk|verse|text of|words of)/i.test(lower)
  const isMore = lower.trim() === 'say more'

  const tanakh = [
    'Genesis','Bereshit','Bereishit','Exodus','Shemot','Leviticus','Vayikra',
    'Numbers','Bamidbar','Deuteronomy','Devarim','Joshua','Yehoshua',
    'Judges','Shoftim','Samuel','Shmuel','Kings','Melachim',
    'Isaiah','Yeshayahu','Jeremiah','Yirmiyahu','Ezekiel','Yechezkel',
    'Hosea','Hoshea','Joel','Yoel','Amos','Obadiah','Ovadiah',
    'Jonah','Yonah','Micah','Michah','Nahum','Nachum',
    'Habakkuk','Chavakuk','Zephaniah','Tzefaniah','Haggai','Chaggai',
    'Zechariah','Zecharyah','Malachi',
    'Psalms','Tehillim','Proverbs','Mishlei','Job','Iyov',
    'Song of Songs','Shir HaShirim','Ruth','Lamentations','Eicha',
    'Ecclesiastes','Kohelet','Esther','Daniel','Ezra',
    'Nehemiah','Nechemiah','Chronicles','Divrei HaYamim',
  ]
  const talmud = [
    'Berakhot','Berachot','Brachot','Shabbat','Eruvin','Pesachim',
    'Shekalim','Yoma','Sukkah','Beitzah','Rosh Hashanah',
    'Taanit','Taanith','Megillah','Moed Katan','Chagigah','Hagigah',
    'Yevamot','Ketubot','Nedarim','Nazir','Sotah','Gittin',
    'Kiddushin','Bava Kamma','Bava Metzia','Bava Batra',
    'Sanhedrin','Makkot','Shevuot','Avodah Zarah','Horayot',
    'Zevachim','Menachot','Chullin','Bekhorot','Arakhin',
    'Temurah','Keritot','Meilah','Niddah',
  ]
  const mishnah = ['Pirkei Avot','Avot','Mishnah','Mishna']
  const rambam = ['Rambam','Maimonides','Mishneh Torah','Hilchot','Hilkhot']
  const shulchanAruch = [
    'Shulchan Aruch','Orach Chaim','Yoreh Deah',
    'Even HaEzer','Choshen Mishpat',
    'Mishnah Berurah','Mishneh Berurah','Kitzur Shulchan Aruch',
  ]
  const commentators = [
    'Rashi','Ramban','Ibn Ezra','Sforno','Radak',
    'Nachmanides','Abarbanel','Alshich','Ohr HaChaim',
  ]
  const kabbalah = [
    'Zohar','Tikunei Zohar','Zohar Chadash',
    'Sefer Yetzirah','Sefer HaBahir',
    'Etz Chaim',"Sha'ar HaGilgulim",
    'Tanya','Likutei Amarim','Likutey Amarim',
    'Likutei Torah','Torah Or',
    'Pardes Rimonim','Pri Etz Chaim','Mevo Shearim',
  ]
  const gematria = [
    'Gematria','Mispar Gadol','Mispar Katan',
    'Mispar Siduri','Atbash','Albam',
    'Sefer Gematriot','Notarikon','Temurah',
  ]
  const mussar = [
    'Chovot HaLevavot','Duties of the Heart',
    'Mesillat Yesharim','Path of the Just',
    'Orchot Tzaddikim','Shaarei Teshuva',
    'Sefer HaChinuch','Kuzari',
    'Moreh Nevuchim','Guide for the Perplexed',
    'Nefesh HaChaim','Maharal','Sfat Emet',
    'Shem MiShmuel','Ben Ish Chai','Ben Ish Hai',
    'Ben Yehoyada','Kaf HaChaim',
  ]
  const midrash = [
    'Midrash Rabbah','Bereishit Rabbah','Shemot Rabbah',
    'Vayikra Rabbah','Bamidbar Rabbah','Devarim Rabbah',
    'Midrash Tanchuma','Tanchuma',
    'Pesikta Rabbati','Pesikta DeRav Kahana',
    'Yalkut Shimoni','Midrash Tehillim',
  ]

  const allSources = [
    ...tanakh, ...talmud, ...mishnah, ...rambam,
    ...shulchanAruch, ...commentators, ...kabbalah,
    ...gematria, ...mussar, ...midrash,
  ]

  const sourcePattern = allSources
    .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
    .join('|')

  const refRegex = new RegExp(
    `(?:(?:Rashi|Ramban|Ibn Ezra|Sforno|Radak|Nachmanides|Ohr HaChaim|Alshich) on )?` +
    `(${sourcePattern})` +
    `(?:\\s+\\d+[ab]?(?::\\d+)?)?`,
    'i'
  )

  const refMatch = text.match(refRegex)
  let detectedRef: string | null = null
  if (refMatch) {
    let ref = refMatch[0].trim()
    ref = ref.replace(/\s+/g, '_').replace(':', '.')
    ref = ref.replace(/_(\d+)([ab])/, '.$1$2')
    detectedRef = ref
  }

  return { needsHebcal, detectedRef, isRecitation, isMore }
}

// ─── Source detection from answer text ───────────────────────

const KNOWN_SOURCES: { pattern: RegExp; label: string; sefariaSlug: string }[] = [
  { pattern: /\bRashi\b/i, label: 'Rashi', sefariaSlug: 'Rashi' },
  { pattern: /\bRamban\b/i, label: 'Ramban', sefariaSlug: 'Ramban' },
  { pattern: /\bRambam\b|Maimonides/i, label: 'Rambam', sefariaSlug: 'Rambam' },
  { pattern: /\bRadak\b/i, label: 'Radak', sefariaSlug: 'Radak' },
  { pattern: /\bIbn Ezra\b/i, label: 'Ibn Ezra', sefariaSlug: 'Ibn_Ezra' },
  { pattern: /\bSforno\b/i, label: 'Sforno', sefariaSlug: 'Sforno' },
  { pattern: /\bNachmanides\b/i, label: 'Nachmanides', sefariaSlug: 'Ramban' },
  { pattern: /\bAbarbanel\b/i, label: 'Abarbanel', sefariaSlug: 'Abarbanel' },
  { pattern: /\bAlshich\b/i, label: 'Alshich', sefariaSlug: 'Alshich' },
  { pattern: /\bOhr HaChaim\b/i, label: 'Ohr HaChaim', sefariaSlug: 'Ohr_HaChaim' },
  { pattern: /\bShulchan Aruch\b/i, label: 'Shulchan Aruch', sefariaSlug: 'Shulchan_Aruch' },
  { pattern: /\bMishnah Berurah\b/i, label: 'Mishnah Berurah', sefariaSlug: 'Mishnah_Berurah' },
  { pattern: /\bBen Ish Chai\b|\bBen Ish Hai\b/i, label: 'Ben Ish Chai', sefariaSlug: 'Ben_Ish_Hai' },
  { pattern: /\bBen Yehoyada\b/i, label: 'Ben Yehoyada', sefariaSlug: 'Ben_Yehoyada' },
  { pattern: /\bKaf HaChaim\b/i, label: 'Kaf HaChaim', sefariaSlug: 'Kaf_HaChaim' },
  { pattern: /\bKitzur\b/i, label: 'Kitzur Shulchan Aruch', sefariaSlug: 'Kitzur_Shulchan_Aruch' },
  { pattern: /\bTalmud\b|\bGemara\b/i, label: 'Talmud Bavli', sefariaSlug: 'Talmud' },
  { pattern: /\bMishnah\b|\bMishna\b/i, label: 'Mishnah', sefariaSlug: 'Mishnah' },
  { pattern: /\bPirkei Avot\b|\bAvot\b/i, label: 'Pirkei Avot', sefariaSlug: 'Pirkei_Avot' },
  { pattern: /\bMidrash\b/i, label: 'Midrash', sefariaSlug: 'Midrash_Rabbah' },
  { pattern: /\bYalkut Shimoni\b/i, label: 'Yalkut Shimoni', sefariaSlug: 'Yalkut_Shimoni' },
  { pattern: /\bTanchuma\b/i, label: 'Midrash Tanchuma', sefariaSlug: 'Midrash_Tanchuma' },
  { pattern: /\bZohar\b/i, label: 'Zohar', sefariaSlug: 'Zohar' },
  { pattern: /\bTanya\b/i, label: 'Tanya', sefariaSlug: 'Tanya' },
  { pattern: /\bSefer Yetzirah\b/i, label: 'Sefer Yetzirah', sefariaSlug: 'Sefer_Yetzirah' },
  { pattern: /\bEtz Chaim\b/i, label: 'Etz Chaim', sefariaSlug: 'Etz_Chaim' },
  { pattern: /\bPardes Rimonim\b/i, label: 'Pardes Rimonim', sefariaSlug: 'Pardes_Rimonim' },
  { pattern: /\bTikunei Zohar\b/i, label: 'Tikunei Zohar', sefariaSlug: 'Tikunei_Zohar' },
  { pattern: /\bChovot HaLevavot\b|Duties of the Heart/i, label: 'Chovot HaLevavot', sefariaSlug: 'Chovot_HaLevavot' },
  { pattern: /\bMesillat Yesharim\b/i, label: 'Mesillat Yesharim', sefariaSlug: 'Mesillat_Yesharim' },
  { pattern: /\bOrchot Tzaddikim\b/i, label: 'Orchot Tzaddikim', sefariaSlug: 'Orchot_Tzaddikim' },
  { pattern: /\bSefer HaChinuch\b/i, label: 'Sefer HaChinuch', sefariaSlug: 'Sefer_HaChinuch' },
  { pattern: /\bKuzari\b/i, label: 'Kuzari', sefariaSlug: 'Kuzari' },
  { pattern: /\bMoreh Nevuchim\b|Guide for the Perplexed/i, label: 'Moreh Nevuchim', sefariaSlug: 'Moreh_Nevuchim' },
  { pattern: /\bNefesh HaChaim\b/i, label: 'Nefesh HaChaim', sefariaSlug: 'Nefesh_HaChaim' },
  { pattern: /\bMaharal\b/i, label: 'Maharal', sefariaSlug: 'Maharal' },
  { pattern: /\bSfat Emet\b/i, label: 'Sfat Emet', sefariaSlug: 'Sfat_Emet' },
  { pattern: /\bShem MiShmuel\b/i, label: 'Shem MiShmuel', sefariaSlug: 'Shem_MiShmuel' },
]

function extractSourcesFromText(text: string): { label: string; url: string }[] {
  const found: { label: string; url: string }[] = []
  const seen = new Set<string>()
  for (const source of KNOWN_SOURCES) {
    if (source.pattern.test(text) && !seen.has(source.label)) {
      seen.add(source.label)
      found.push({ label: source.label, url: `https://www.sefaria.org/${source.sefariaSlug}` })
    }
  }
  return found
}

// ─── Sefaria text by ref ──────────────────────────────────────

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

// ─── Sefaria full-text search ─────────────────────────────────

async function searchSefaria(query: string, limit = 3): Promise<{ ref: string; text: string; url: string }[]> {
  try {
    const body = {
      query: {
        query_string: {
          query: query,
          fields: ['exact', 'naive_lemmatizer']
        }
      },
      size: limit,
      _source: ['ref', 'heRef', 'text', 'exact']
    }

    const res = await fetch('https://www.sefaria.org/api/search-wrapper/text/_search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) return []
    const data = await res.json()
    const hits = data?.hits?.hits || []

    return hits.map((hit: any) => ({
      ref: hit._source?.ref || '',
      text: (hit._source?.exact || hit._source?.text || '').slice(0, 300),
      url: `https://www.sefaria.org/${hit._source?.ref?.replace(/\s/g, '_') || ''}`,
    })).filter((r: any) => r.ref && r.text)
  } catch {
    return []
  }
}

// ─── Sefaria related texts for a ref ─────────────────────────

async function getRelatedTexts(ref: string, limit = 3): Promise<{ ref: string; text: string; url: string }[]> {
  try {
    const encoded = encodeURIComponent(ref)
    const res = await fetch(`https://www.sefaria.org/api/related/${encoded}`)
    if (!res.ok) return []
    const data = await res.json()
    const links = (data?.links || [])
      .filter((l: any) => l.category !== 'Commentary') // skip basic commentary, get richer links
      .slice(0, limit)

    const results: { ref: string; text: string; url: string }[] = []
    for (const link of links) {
      const linkRef = link.ref || link.anchorRef
      if (!linkRef) continue
      const text = await getTextByRef(linkRef)
      if (text) {
        results.push({
          ref: linkRef,
          text: text.slice(0, 300),
          url: `https://www.sefaria.org/${linkRef.replace(/\s/g, '_')}`,
        })
      }
    }
    return results
  } catch {
    return []
  }
}

// ─── Hebcal ───────────────────────────────────────────────────

async function getShabbatData(geonameid = '5368361'): Promise<string> {
  try {
    const res = await fetch(`https://www.hebcal.com/shabbat?cfg=json&geonameid=${geonameid}&M=on&leyning=on`)
    if (!res.ok) return ''
    const data = await res.json()
    return data?.items?.map((i: any) => `${i.category}: ${i.title}${i.date ? ' on ' + i.date : ''}`).join('. ') || ''
  } catch { return '' }
}

async function getHolidayData(): Promise<string> {
  try {
    const now = new Date()
    const res = await fetch(
      `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&mod=on&nx=on&year=${now.getFullYear()}&month=x&tz=America/Los_Angeles&locale=en&c=on&geo=geoname&geonameid=5368361`
    )
    if (!res.ok) return ''
    const data = await res.json()
    return data?.items?.filter((i: any) => i.date && new Date(i.date) >= now)
      .slice(0, 10).map((i: any) => `${i.title} on ${i.date}`).join(', ') || ''
  } catch { return '' }
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
  } catch { return '' }
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
  const body: any = { text, model_id: ELEVENLABS_MODEL, voice_settings: VOICE_SETTINGS }
  if (lang === 'he') body.language_code = 'he'
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${SEFATAI_VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY!,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`ElevenLabs error: ${res.status} - ${await res.text()}`)
  return res.arrayBuffer()
}

// ─── Stitch audio ─────────────────────────────────────────────

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

const SYSTEM_PROMPT = `You are Sefatai, a calm, warm, and deeply knowledgeable Jewish learning companion with expertise across Torah, Talmud, halacha, Jewish philosophy, Kabbalah, gematria, and the full range of Jewish tradition — Ashkenazi, Sephardi, and Mizrahi.

Your role is to teach, explain, and illuminate Jewish texts, laws, concepts, prayers, and traditions with clarity and depth.

How you answer:
- Lead with the Torah or Talmudic source when relevant
- Cite commentators naturally: Rashi, Rambam, Shulchan Aruch, Mishnah Berurah, Ben Ish Chai, Kaf HaChaim, Zohar, Tanya, etc.
- When quoting Hebrew or Aramaic, ALWAYS include full nikud (vowel marks) so text-to-speech pronounces correctly — e.g. צַלְמָוֶת not צלמות, שְׁמַע not שמע
- Speak like a knowledgeable chavruta partner — direct, warm, intellectually alive
- For regular questions: maximum 3 sentences
- If the user says "say more", look at the conversation history and the retrieved sources, then give a deeper teaching drawing from those sources. Maximum 3 sentences.
- For recitation requests: recite the COMPLETE text in full with full nikud — do not cut off or summarize
- No markdown, no bullet points, no headers — spoken text only
- When reciting multiple verses, put each verse on its own line

On halachic questions:
- Answer with the relevant sources and how the mainstream poskim rule
- Share the Sephardic/Mizrahi ruling when relevant
- End with a brief natural caveat such as "though for your specific situation, best to ask your rav"

On Kabbalah and gematria:
- Draw from Zohar, Tanya, Sefer Yetzirah, Etz Chaim, and classic kabbalistic sources
- For gematria, calculate accurately and cite the source

On calendar questions:
- Use the retrieved calendar data to give precise current answers

Never introduce yourself. Never give a welcome message. Just answer.`

// ─── Main handler ─────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { userInput, history, locationId } = body

    const { needsHebcal, detectedRef, isRecitation, isMore } = detectIntent(userInput || '')

    let retrievedContext = ''
    const sources: { label: string; url?: string }[] = []

    if (detectedRef) {
      const text = await getTextByRef(detectedRef)
      if (text) {
        retrievedContext += `\nSource text for ${detectedRef}:\n${text.slice(0, isRecitation ? 5000 : 1000)}`
        sources.push({
          label: `Sefaria: ${detectedRef.replace(/_/g, ' ')}`,
          url: `https://www.sefaria.org/${detectedRef}`
        })
      }

      // For MORE — fetch related texts linked to the ref
      if (isMore) {
        const related = await getRelatedTexts(detectedRef, 3)
        if (related.length > 0) {
          retrievedContext += `\n\nRelated sources from Sefaria:\n`
          for (const r of related) {
            retrievedContext += `\n${r.ref}:\n${r.text}\n`
            sources.push({ label: `Sefaria: ${r.ref}`, url: r.url })
          }
        }
      }
    } else if (!needsHebcal) {
      // No specific ref — search Sefaria for relevant sources
      // Skip search for "say more" since history has the context
      if (!isMore) {
        const searchResults = await searchSefaria(userInput || '', 3)
        if (searchResults.length > 0) {
          retrievedContext += `\nRelevant sources from Sefaria:\n`
          for (const r of searchResults) {
            retrievedContext += `\n${r.ref}:\n${r.text}\n`
            sources.push({ label: `Sefaria: ${r.ref}`, url: r.url })
          }
        }
      } else {
        // MORE with no ref — search based on last assistant message in history
        const lastAssistant = [...(history || [])].reverse().find((h: any) => h.role === 'assistant')
        if (lastAssistant?.content) {
          const searchResults = await searchSefaria(lastAssistant.content, 3)
          if (searchResults.length > 0) {
            retrievedContext += `\nAdditional sources from Sefaria:\n`
            for (const r of searchResults) {
              retrievedContext += `\n${r.ref}:\n${r.text}\n`
              sources.push({ label: `Sefaria: ${r.ref}`, url: r.url })
            }
          }
        }
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

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: isRecitation ? 1500 : 200,
      system: SYSTEM_PROMPT,
      messages: [...historyMessages, { role: 'user', content: userMessage }],
    })

    const spokenText = message.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('').trim()

    const mentionedSources = extractSourcesFromText(spokenText)
    const existingLabels = new Set(sources.map(s => s.label))
    for (const s of mentionedSources) {
      if (!existingLabels.has(s.label)) {
        sources.push(s)
        existingLabels.add(s.label)
      }
    }

// CHUNKING_ENABLED env var — set to 'false' in Vercel to disable chunking
    const chunkingEnabled = process.env.CHUNKING_ENABLED !== 'false'
    const chunks = chunkByLanguage(spokenText)
    let stitched: ArrayBuffer

    if (!chunkingEnabled || (chunks.length === 1 && chunks[0].lang === 'en')) {
      // Single call — no chunking
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${SEFATAI_VOICE_ID}`, {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY!,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({ text: spokenText, model_id: ELEVENLABS_MODEL, voice_settings: VOICE_SETTINGS }),
      })
      if (!res.ok) throw new Error(`ElevenLabs error: ${res.status}`)
      stitched = await res.arrayBuffer()
    } else {
      // Chunked — batch in groups of 4
      const audioBuffers: ArrayBuffer[] = []
      for (let i = 0; i < chunks.length; i += 4) {
        const batch = chunks.slice(i, i + 4)
        const batchBuffers = await Promise.all(batch.map(chunk => ttsChunk(chunk.text, chunk.lang)))
        audioBuffers.push(...batchBuffers)
      }
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
