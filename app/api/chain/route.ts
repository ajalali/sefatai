export const runtime = 'nodejs'

import Anthropic from '@anthropic-ai/sdk'
import { SEFATAI_VOICE_ID, VOICE_SETTINGS, ELEVENLABS_MODEL } from '@/lib/voices'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Sefaria URL helper ───────────────────────────────────────

function toSefariaUrl(ref: string): string {
  return ref.trim().replace(/:/g, '.').replace(/\s+/g, '_')
}

async function validateSefariaRef(ref: string, fallbackSlug: string): Promise<string> {
  try {
    const encoded = encodeURIComponent(toSefariaUrl(ref))
    const res = await fetch(`https://www.sefaria.org/api/v3/texts/${encoded}`, { method: 'HEAD' })
    if (res.ok) return `https://www.sefaria.org/${toSefariaUrl(ref)}`
  } catch { /* fall through */ }
  return `https://www.sefaria.org/${fallbackSlug}`
}

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
  if (refMatch) detectedRef = refMatch[0].trim()

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

// Extract specific refs from answer text e.g. "Rashi on Genesis 1:1"
const SPECIFIC_REF_PATTERN = /(?:Rashi|Ramban|Ibn Ezra|Sforno|Radak|Nachmanides|Ohr HaChaim|Alshich|Rambam|Ben Ish Chai|Ben Ish Hai|Tanya|Zohar|Mishnah Berurah|Shulchan Aruch)\s+(?:on\s+)?(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Psalms|Proverbs|Isaiah|Berakhot|Shabbat|Chapter|Bereshit|Shemot)\s*[\d:ab.]+/gi

async function extractSourcesFromText(text: string): Promise<{ label: string; url: string }[]> {
  const found: { label: string; url: string }[] = []
  const seen = new Set<string>()

  // First try to extract specific refs like "Rashi on Genesis 1:1"
  const specificRefs = text.match(SPECIFIC_REF_PATTERN) || []
  for (const ref of specificRefs) {
    if (seen.has(ref)) continue
    seen.add(ref)
    // Find the fallback slug from KNOWN_SOURCES
    const source = KNOWN_SOURCES.find(s => s.pattern.test(ref.split(/\s+/)[0]))
    const fallback = source?.sefariaSlug || 'texts'
    const url = await validateSefariaRef(ref, fallback)
    found.push({ label: ref, url })
  }

  // Then add general source mentions not already covered
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
    const encoded = encodeURIComponent(toSefariaUrl(ref))
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
    return hits.map((hit: any) => {
      const ref = hit._source?.ref || ''
      return {
        ref,
        text: (hit._source?.exact || hit._source?.text || '').slice(0, 300),
        url: `https://www.sefaria.org/${toSefariaUrl(ref)}`,
      }
    }).filter((r: any) => r.ref && r.text)
  } catch {
    return []
  }
}

// ─── Sefaria related texts ────────────────────────────────────

async function getRelatedTexts(ref: string, limit = 3): Promise<{ ref: string; text: string; url: string }[]> {
  try {
    const encoded = encodeURIComponent(toSefariaUrl(ref))
    const res = await fetch(`https://www.sefaria.org/api/related/${encoded}`)
    if (!res.ok) return []
    const data = await res.json()
    const links = (data?.links || [])
      .filter((l: any) => l.category !== 'Commentary')
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
          url: `https://www.sefaria.org/${toSefariaUrl(linkRef)}`,
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

// ─── ElevenLabs TTS ───────────────────────────────────────────

async function textToSpeech(text: string): Promise<ArrayBuffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${SEFATAI_VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY!,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL,
      voice_settings: VOICE_SETTINGS,
    }),
  })
  if (!res.ok) throw new Error(`ElevenLabs error: ${res.status} - ${await res.text()}`)
  return res.arrayBuffer()
}

// ─── System prompt ────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Sefatai, a calm, warm, and deeply knowledgeable Jewish learning companion with expertise across Torah, Talmud, halacha, Jewish philosophy, Kabbalah, gematria, and the full range of Jewish tradition — Ashkenazi, Sephardi, and Mizrahi.

Your role is to teach, explain, and illuminate Jewish texts, laws, concepts, prayers, and traditions with clarity and depth.

How you answer:
- Lead with the Torah or Talmudic source when relevant
- Cite commentators with specific refs when possible — e.g. "Rashi on Genesis 1:1", "Ben Ish Chai, Bereshit, Year 1", "Tanya Chapter 1", "Zohar, Bereishit 3b" — so sources can be linked precisely
- When quoting Hebrew or Aramaic, ALWAYS include full nikud (vowel marks) so text-to-speech pronounces correctly — e.g. צַלְמָוֶת not צלמות, שְׁמַע not שמע
- Speak like a knowledgeable chavruta partner — direct, warm, intellectually alive
- For regular questions: maximum 3 sentences
- If the user says "say more", look at the conversation history and retrieved sources, then give a deeper teaching from those sources. Maximum 3 sentences.
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
          label: `Sefaria: ${detectedRef}`,
          url: `https://www.sefaria.org/${toSefariaUrl(detectedRef)}`
        })
      }
      if (isMore) {
        const related = await getRelatedTexts(detectedRef, 3)
        for (const r of related) {
          retrievedContext += `\n\n${r.ref}:\n${r.text}`
          sources.push({ label: `Sefaria: ${r.ref}`, url: r.url })
        }
      }
    } else if (!needsHebcal && !isMore) {
      const searchResults = await searchSefaria(userInput || '', 3)
      for (const r of searchResults) {
        retrievedContext += `\n\n${r.ref}:\n${r.text}`
        sources.push({ label: `Sefaria: ${r.ref}`, url: r.url })
      }
    } else if (isMore) {
      const lastAssistant = [...(history || [])].reverse().find((h: any) => h.role === 'assistant')
      if (lastAssistant?.content) {
        const searchResults = await searchSefaria(lastAssistant.content, 3)
        for (const r of searchResults) {
          retrievedContext += `\n\n${r.ref}:\n${r.text}`
          sources.push({ label: `Sefaria: ${r.ref}`, url: r.url })
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

    // Extract sources — now async for validation
    const mentionedSources = await extractSourcesFromText(spokenText)
    const existingLabels = new Set(sources.map(s => s.label))
    for (const s of mentionedSources) {
      if (!existingLabels.has(s.label)) {
        sources.push(s)
        existingLabels.add(s.label)
      }
    }

    const audio = await textToSpeech(spokenText)

    return new Response(audio, {
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
