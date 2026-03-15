export const runtime = 'nodejs'

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { SEFATAI_VOICE_ID, VOICE_SETTINGS } from '@/lib/voices'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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

// ─── Source list — built once at module level ─────────────────

const TANAKH = [
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
const TALMUD = [
  'Berakhot','Berachot','Brachot','Shabbat','Eruvin','Pesachim',
  'Shekalim','Yoma','Sukkah','Beitzah','Rosh Hashanah',
  'Taanit','Taanith','Megillah','Moed Katan','Chagigah','Hagigah',
  'Yevamot','Ketubot','Nedarim','Nazir','Sotah','Gittin',
  'Kiddushin','Bava Kamma','Bava Metzia','Bava Batra',
  'Sanhedrin','Makkot','Shevuot','Avodah Zarah','Horayot',
  'Zevachim','Menachot','Chullin','Bekhorot','Arakhin',
  'Temurah','Keritot','Meilah','Niddah',
]
const MISHNAH = ['Pirkei Avot','Avot','Mishnah','Mishna']
const RAMBAM = ['Rambam','Maimonides','Mishneh Torah','Hilchot','Hilkhot']
const SHULCHAN_ARUCH = [
  'Shulchan Aruch','Orach Chaim','Yoreh Deah',
  'Even HaEzer','Choshen Mishpat',
  'Mishnah Berurah','Mishneh Berurah','Kitzur Shulchan Aruch',
]
const COMMENTATORS = [
  'Rashi','Ramban','Ibn Ezra','Sforno','Radak',
  'Nachmanides','Abarbanel','Alshich','Ohr HaChaim',
]
const KABBALAH = [
  'Zohar','Tikunei Zohar','Zohar Chadash',
  'Sefer Yetzirah','Sefer HaBahir',
  'Etz Chaim',"Sha'ar HaGilgulim",
  'Tanya','Likutei Amarim','Likutey Amarim',
  'Likutei Torah','Torah Or',
  'Pardes Rimonim','Pri Etz Chaim','Mevo Shearim',
]
const GEMATRIA_BOOKS = ['Sefer Gematriot','Notarikon']
const MUSSAR = [
  'Chovot HaLevavot','Duties of the Heart',
  'Mesillat Yesharim','Mesilat Yesharim','Path of the Just',
  'Orchot Tzaddikim','Shaarei Teshuva',
  'Sefer HaChinuch','Kuzari',
  'Moreh Nevuchim','Guide for the Perplexed',
  'Nefesh HaChaim','Maharal','Sfat Emet',
  'Shem MiShmuel','Ben Ish Chai','Ben Ish Hai',
  'Ben Yehoyada','Kaf HaChaim',
  'Ramchal','Luzzatto','Derech Hashem',"Da'at Tevunot",
]
const MIDRASH = [
  'Midrash Rabbah','Bereishit Rabbah','Shemot Rabbah',
  'Vayikra Rabbah','Bamidbar Rabbah','Devarim Rabbah',
  'Midrash Tanchuma','Tanchuma',
  'Pesikta Rabbati','Pesikta DeRav Kahana',
  'Yalkut Shimoni','Midrash Tehillim',
]

const ALL_SOURCES = [
  ...TANAKH, ...TALMUD, ...MISHNAH, ...RAMBAM,
  ...SHULCHAN_ARUCH, ...COMMENTATORS, ...KABBALAH,
  ...GEMATRIA_BOOKS, ...MUSSAR, ...MIDRASH,
]

const SOURCE_PATTERN = ALL_SOURCES
  .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .sort((a, b) => b.length - a.length)
  .join('|')

const REF_REGEX = new RegExp(
  `(?:(?:Rashi|Ramban|Ibn Ezra|Sforno|Radak|Nachmanides|Ohr HaChaim|Alshich) on )?` +
  `(${SOURCE_PATTERN})` +
  `(?:\\s+\\d+[ab]?(?::\\d+)?)?`,
  'i'
)

// ─── Intent detection ─────────────────────────────────────────

function detectIntent(text: string): {
  needsHebcal: boolean
  detectedRef: string | null
  isRecitation: boolean
  isMore: boolean
  isGematria: boolean
  gematriaQuery: string | null
} {
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

  const gematriaKeywords = [
    'gematria', 'gematria of', 'numerical value', 'equals in gematria',
    'what is the value', 'gematria equal', 'shares gematria', 'same gematria',
    'atbash', 'albam', 'mispar', 'notarikon', 'temurah',
    'what words equal', 'what torah words', 'what equals', 'numerically equal',
  ]
  const isGematria = gematriaKeywords.some(k => lower.includes(k))
  const gematriaQuery = isGematria ? text : null
  const refMatch = text.match(REF_REGEX)
  const detectedRef = refMatch ? refMatch[0].trim() : null

  return { needsHebcal, detectedRef, isRecitation, isMore, isGematria, gematriaQuery }
}

// ─── TorahCalc Gematria ───────────────────────────────────────

type GematriaResult = { calculation: any; matches: any }

async function getGematria(text: string): Promise<GematriaResult> {
  try {
    const [calcRes, searchRes] = await Promise.all([
      fetch(`https://www.torahcalc.com/api/gematria?text=${encodeURIComponent(text)}`),
      fetch(`https://www.torahcalc.com/api/gematriasearch?text=${encodeURIComponent(text)}`),
    ])
    const calculation = calcRes.ok ? await calcRes.json() : null
    const matches = searchRes.ok ? await searchRes.json() : null
    return { calculation, matches }
  } catch {
    return { calculation: null, matches: null }
  }
}

function formatGematriaContext(result: GematriaResult): string {
  if (!result.calculation && !result.matches) return ''
  let context = ''
  if (result.calculation?.result) {
    const methods = result.calculation.result
    const keyMethods = ['Mispar Hechrachi','Mispar Gadol','Mispar Siduri','Mispar Katan','Atbash','Mispar Kolel']
    context += '\nGematria values:\n'
    for (const method of keyMethods) {
      const entry = methods[method]
      if (entry) context += `${method}: ${entry.value}\n`
    }
  }
  if (result.matches?.result) {
    const r = result.matches.result
    context += '\nTorah words with same gematria:\n'
    if (r.wordsInTorah?.length) {
      context += r.wordsInTorah.slice(0, 8).map((w: any) => `${w.word} (${w.ref || ''})`).join(', ') + '\n'
    }
    if (r.versesInTorah?.length) {
      context += '\nTorah verses with same gematria:\n'
      context += r.versesInTorah.slice(0, 3).map((v: any) => `${v.ref}: ${v.text?.slice(0, 80) || ''}`).join('\n') + '\n'
    }
  }
  return context
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
  { pattern: /\bMesillat Yesharim\b|\bMesilat Yesharim\b/i, label: 'Mesillat Yesharim', sefariaSlug: 'Mesillat_Yesharim' },
  { pattern: /\bRamchal\b|\bLuzzatto\b/i, label: 'Ramchal', sefariaSlug: 'Moshe_Chaim_Luzzatto' },
  { pattern: /\bDerech Hashem\b/i, label: 'Derech Hashem', sefariaSlug: 'Derech_Hashem' },
  { pattern: /\bDa.at Tevunot\b/i, label: "Da'at Tevunot", sefariaSlug: 'Daat_Tevunot' },
  { pattern: /\bOrchot Tzaddikim\b/i, label: 'Orchot Tzaddikim', sefariaSlug: 'Orchot_Tzaddikim' },
  { pattern: /\bSefer HaChinuch\b/i, label: 'Sefer HaChinuch', sefariaSlug: 'Sefer_HaChinuch' },
  { pattern: /\bKuzari\b/i, label: 'Kuzari', sefariaSlug: 'Kuzari' },
  { pattern: /\bMoreh Nevuchim\b|Guide for the Perplexed/i, label: 'Moreh Nevuchim', sefariaSlug: 'Moreh_Nevuchim' },
  { pattern: /\bNefesh HaChaim\b/i, label: 'Nefesh HaChaim', sefariaSlug: 'Nefesh_HaChaim' },
  { pattern: /\bMaharal\b/i, label: 'Maharal', sefariaSlug: 'Maharal' },
  { pattern: /\bSfat Emet\b/i, label: 'Sfat Emet', sefariaSlug: 'Sfat_Emet' },
  { pattern: /\bShem MiShmuel\b/i, label: 'Shem MiShmuel', sefariaSlug: 'Shem_MiShmuel' },
]

const SPECIFIC_REF_PATTERN = /(?:Rashi|Ramban|Ibn Ezra|Sforno|Radak|Nachmanides|Ohr HaChaim|Alshich|Rambam|Ben Ish Chai|Ben Ish Hai|Tanya|Zohar|Mishnah Berurah|Shulchan Aruch|Ramchal)\s+(?:on\s+)?(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Psalms|Proverbs|Isaiah|Berakhot|Shabbat|Chapter|Bereshit|Shemot)\s*[\d:ab.]+/gi

async function extractSourcesFromText(text: string): Promise<{ label: string; url: string }[]> {
  const found: { label: string; url: string }[] = []
  const seen = new Set<string>()

  const specificRefs = text.match(SPECIFIC_REF_PATTERN) || []

  await Promise.all(specificRefs.map(async (ref) => {
    if (seen.has(ref)) return
    seen.add(ref)
    const source = KNOWN_SOURCES.find(s => s.pattern.test(ref.split(/\s+/)[0]))
    const fallback = source?.sefariaSlug || 'texts'
    const url = await validateSefariaRef(ref, fallback)
    found.push({ label: ref, url })
  }))

  for (const source of KNOWN_SOURCES) {
    if (!source.sefariaSlug) continue
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
      query: { query_string: { query, fields: ['exact', 'naive_lemmatizer'] } },
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
    return (data?.hits?.hits || []).map((hit: any) => {
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

// ─── Sefaria related texts — parallelized ────────────────────

async function getRelatedTexts(ref: string, limit = 3): Promise<{ ref: string; text: string; url: string }[]> {
  try {
    const encoded = encodeURIComponent(toSefariaUrl(ref))
    const res = await fetch(`https://www.sefaria.org/api/related/${encoded}`)
    if (!res.ok) return []
    const data = await res.json()
    const links = (data?.links || []).filter((l: any) => l.category !== 'Commentary').slice(0, limit)
    const linkRefs: string[] = links.map((l: any) => l.ref || l.anchorRef).filter(Boolean)
    const texts = await Promise.all(linkRefs.map((linkRef: string) => getTextByRef(linkRef)))
    const results: { ref: string; text: string; url: string }[] = linkRefs.map((linkRef: string, i: number) => ({
      ref: linkRef,
      text: texts[i].slice(0, 300),
      url: `https://www.sefaria.org/${toSefariaUrl(linkRef)}`,
    }))
    return results.filter(r => r.text)
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
    const res = await fetch(`https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&mod=on&nx=on&year=${now.getFullYear()}&month=x&tz=America/Los_Angeles&locale=en&c=on&geo=geoname&geonameid=5368361`)
    if (!res.ok) return ''
    const data = await res.json()
    return data?.items?.filter((i: any) => i.date && new Date(i.date) >= now)
      .slice(0, 10).map((i: any) => `${i.title} on ${i.date}`).join(', ') || ''
  } catch { return '' }
}

async function getHebrewDate(): Promise<string> {
  try {
    const now = new Date()
    const res = await fetch(`https://www.hebcal.com/converter?cfg=json&gy=${now.getFullYear()}&gm=${now.getMonth() + 1}&gd=${now.getDate()}&g2h=1`)
    if (!res.ok) return ''
    const data = await res.json()
    return data?.hdate || ''
  } catch { return '' }
}

// ─── Speech sanitization ──────────────────────────────────────

function sanitizeForSpeech(text: string): string {
  let out = text
    .replace(/יהוה\s*'s/g, "Hashem's")
    .replace(/ה׳\s*'s/g, "Hashem's")
    .replace(/ד׳\s*'s/g, "Hashem's")
    .replace(/יהוה/g, 'Hashem')
    .replace(/ה׳/g, 'Hashem')
    .replace(/ד׳/g, 'Hashem')

  // Hebrew letter names — ONLY when isolated next to = and a number
  const letterNames: [string, string][] = [
    ['א', 'Alef'], ['ב', 'Bet'], ['ג', 'Gimel'], ['ד', 'Dalet'],
    ['ה', 'Hey'], ['ו', 'Vav'], ['ז', 'Zayin'], ['ח', 'Chet'],
    ['ט', 'Tet'], ['י', 'Yod'], ['כ', 'Kaf'], ['ך', 'Kaf Sofit'],
    ['ל', 'Lamed'], ['מ', 'Mem'], ['ם', 'Mem Sofit'], ['נ', 'Nun'],
    ['ן', 'Nun Sofit'], ['ס', 'Samech'], ['ע', 'Ayin'], ['פ', 'Peh'],
    ['ף', 'Peh Sofit'], ['צ', 'Tzadi'], ['ץ', 'Tzadi Sofit'],
    ['ק', 'Kuf'], ['ר', 'Resh'], ['ש', 'Shin'], ['ת', 'Tav'],
  ]

  for (const [char, name] of letterNames) {
    const escaped = char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(
      new RegExp(`(?<![\\u05D0-\\u05EA])${escaped}(?![\\u05D0-\\u05EA])\\s*=\\s*(\\d+)`, 'g'),
      `${name} = $1`
    )
  }

  return out
}

// ─── ElevenLabs TTS — smart model switcher ────────────────────

async function textToSpeech(text: string, highQuality = false): Promise<ArrayBuffer> {
  // Recitations use v3 for best Hebrew pronunciation
  // Everything else uses Flash for speed and cost
  const model = highQuality
    ? (process.env.ELEVENLABS_MODEL_ID || 'eleven_v3')
    : 'eleven_flash_v2_5'

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${SEFATAI_VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY!,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({ text, model_id: model, voice_settings: VOICE_SETTINGS }),
  })
  if (!res.ok) throw new Error(`ElevenLabs error: ${res.status} - ${await res.text()}`)
  return res.arrayBuffer()
}

// ─── System prompt ────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Sefatai, a calm, warm, and deeply knowledgeable Jewish learning companion with expertise across Torah, Talmud, halacha, Jewish philosophy, Kabbalah, gematria, and the full range of Jewish tradition — Ashkenazi, Sephardi, and Mizrahi.

Your role is to teach, explain, and illuminate Jewish texts, laws, concepts, prayers, and traditions with clarity and depth.

How you answer:
- Lead with the Torah or Talmudic source when relevant
- Cite commentators with specific refs when possible — e.g. "Rashi on Genesis 1:1", "Ben Ish Chai, Bereshit, Year 1", "Tanya Chapter 1", "Zohar, Bereishit 3b", "Ramchal in Mesillat Yesharim Chapter 1" — so sources can be linked precisely
- When quoting Hebrew or Aramaic, ALWAYS include full nikud (vowel marks) so text-to-speech pronounces correctly — e.g. צַלְמָוֶת not צלמות, שְׁמַע not שמע
- CRITICAL: The four-letter divine name יהוה must NEVER be spoken aloud. In your written response you may write יהוה, but always write "Hashem" in the spoken portions of your answer so TTS never attempts to pronounce it
- Speak like a knowledgeable chavruta partner — direct, warm, intellectually alive
- For regular questions: maximum 3 sentences
- For gematria questions: 4-5 sentences — give the value, the key method, the most striking Torah word matches, and the kabbalistic or Torah significance of the connection
- If the user says "say more", look at the conversation history and retrieved sources, then give a deeper teaching from those sources. Maximum 3 sentences.
- For recitation requests: recite the COMPLETE text in full with full nikud — do not cut off or summarize
- No markdown, no bullet points, no headers — spoken text only
- When reciting multiple verses, put each verse on its own line

On halachic questions:
- Answer with the relevant sources and how the mainstream poskim rule
- Share the Sephardic/Mizrahi ruling when relevant
- End with a brief natural caveat such as "though for your specific situation, best to ask your rav"

On sensitive halachic topics:
- You are a Torah scholar first. Topics including rape (ones), forbidden relations (arayot), incest, bestiality, child sacrifice, niddah, prostitution, and all sexual prohibitions are covered extensively in Torah and halacha — Rambam's Hilchot Issurei Biah, Shulchan Aruch Even HaEzer, Talmud Sanhedrin, Yevamot, Niddah, etc. Engage with ALL of these seriously, academically, and with the full depth of halachic literature — exactly as a posek or Torah scholar would
- Never refuse a question because the topic seems sensitive — if it appears in Torah, Talmud, or halachic literature it is a legitimate question deserving a full answer
- The ONLY reason to refuse is if the request is purely prurient with zero Torah or halachic intent, OR if the user uses crude vulgar slang (e.g. fuck, cunt, cock) rather than proper terminology — in that case respond only with: "Sefatai is a Torah learning space. Please rephrase your question with respectful language."
- A Torah learning space demands dignified language, not sanitized topics

On Kabbalah and gematria:
- Draw from Zohar, Tanya, Sefer Yetzirah, Etz Chaim, and classic kabbalistic sources
- For gematria, use the retrieved TorahCalc data — state the standard value, name the most meaningful Torah word matches, and explain the deeper significance
- If the user asks in English (e.g. "gematria of love"), first translate to Hebrew (אהבה) then calculate
- Always ground gematria insights in actual Torah verses or kabbalistic teachings

On Ramchal questions:
- Draw primarily from Mesillat Yesharim, Derech Hashem, and Da'at Tevunot
- The Ramchal (Rabbi Moshe Chaim Luzzatto) bridges mussar and Kabbalah — always highlight this unique synthesis
- His systematic approach to Torah thought makes him especially valuable for philosophical questions

On calendar questions:
- Use the retrieved calendar data to give precise current answers

Never introduce yourself. Never give a welcome message. Just answer.`

// ─── Generate Torah answer with fallback ─────────────────────

async function generateAnswer(
  historyMessages: any[],
  userMessage: string,
  maxTokens: number
): Promise<string> {

  // Primary: Claude Sonnet 4
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      messages: [...historyMessages, { role: 'user', content: userMessage }],
    })
    const result = message.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('').trim()
    if (result) return result
  } catch (e) {
    console.warn('Sonnet failed, falling back to GPT-4.1:', e)
  }

  // Fallback: GPT-4.1
  try {
    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4.1',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...historyMessages.map((h: any) => ({
          role: h.role as 'user' | 'assistant',
          content: h.content,
        })),
        { role: 'user', content: userMessage },
      ],
    })
    const result = completion.choices[0]?.message?.content?.trim() || ''
    if (result) {
      console.log('Answered with GPT-4.1 fallback')
      return result
    }
  } catch (e) {
    console.warn('GPT-4.1 fallback failed:', e)
  }

  throw new Error('All models failed to generate a response')
}

// ─── Main handler ─────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { userInput, history, locationId } = body

    const { needsHebcal, detectedRef, isRecitation, isMore, isGematria, gematriaQuery } = detectIntent(userInput || '')

    let retrievedContext = ''
    const sources: { label: string; url?: string }[] = []

    if (isGematria && gematriaQuery) {
      const hebrewMatch = gematriaQuery.match(/[\u05D0-\u05EA\u05F0-\u05F4\uFB1D-\uFB4F]+/)
      const searchTerm = hebrewMatch ? hebrewMatch[0] : gematriaQuery
      const gResult = await getGematria(searchTerm)
      const gContext = formatGematriaContext(gResult)
      if (gContext) {
        retrievedContext += `\nTorahCalc Gematria data:\n${gContext}`
        sources.push({ label: 'TorahCalc Gematria', url: 'https://www.torahcalc.com/tools/gematria-search' })
      }
      if (gResult.matches?.result?.versesInTorah?.length) {
        for (const v of gResult.matches.result.versesInTorah.slice(0, 2)) {
          if (v.ref) sources.push({ label: `Sefaria: ${v.ref}`, url: `https://www.sefaria.org/${toSefariaUrl(v.ref)}` })
        }
      }
    }

    if (detectedRef && !isGematria) {
      const text = await getTextByRef(detectedRef)
      if (text) {
        retrievedContext += `\nSource text for ${detectedRef}:\n${text.slice(0, isRecitation ? 5000 : 1000)}`
        sources.push({ label: `Sefaria: ${detectedRef}`, url: `https://www.sefaria.org/${toSefariaUrl(detectedRef)}` })
      }
      if (isMore) {
        const related = await getRelatedTexts(detectedRef, 3)
        for (const r of related) {
          retrievedContext += `\n\n${r.ref}:\n${r.text}`
          sources.push({ label: `Sefaria: ${r.ref}`, url: r.url })
        }
      }
    } else if (!needsHebcal && !isMore && !isGematria) {
      const searchResults = await searchSefaria(userInput || '', 3)
      for (const r of searchResults) {
        retrievedContext += `\n\n${r.ref}:\n${r.text}`
        sources.push({ label: `Sefaria: ${r.ref}`, url: r.url })
      }
    } else if (isMore && !isGematria) {
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
    const maxTokens = isRecitation ? 4000 : isGematria ? 600 : 500

    const spokenText = await generateAnswer(historyMessages, userMessage, maxTokens)

    const mentionedSources = await extractSourcesFromText(spokenText)
    const existingLabels = new Set(sources.map(s => s.label))
    for (const s of mentionedSources) {
      if (!existingLabels.has(s.label)) {
        sources.push(s)
        existingLabels.add(s.label)
      }
    }

    // Recitations use v3 for quality, everything else uses Flash for speed
    const audio = await textToSpeech(sanitizeForSpeech(spokenText), isRecitation)

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
