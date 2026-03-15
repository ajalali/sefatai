import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM = `You are a Jewish text transcription normalizer. You receive a raw voice transcript that may contain mispronounced or phonetically spelled Hebrew names, places, books, and concepts. Your job is to:

1. Fix mispronounced Hebrew names to their correct English transliteration — e.g. "moshen" → "Moshe", "moishe" → "Moshe", "avrohom" → "Avraham", "bereishis" → "Bereishit", "shabbos" → "Shabbat" (keep Ashkenazi if clearly intended)
2. Add the Hebrew in parentheses for key proper nouns — e.g. "Moshe (מֹשֶׁה)", "Avraham (אַבְרָהָם)", "Torah (תּוֹרָה)"
3. Fix book names — "bereishis" → "Bereishit", "tehillim" → "Tehillim (Psalms)"
4. Fix rabbi names — "the rambam" → "the Rambam", "rav kook" → "Rav Kook", "bnai schai" → "Ben Ish Chai", "ramchal" → "Ramchal"
5. Keep the meaning and intent of the question exactly — only fix names and entities, never rewrite the question
6. If nothing needs fixing, return the transcript unchanged

Return ONLY the normalized transcript — no explanation, no preamble.`

async function normalizeTranscript(raw: string): Promise<string> {

  // 1. Haiku — fast and cheap
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      system: SYSTEM,
      messages: [{ role: 'user', content: raw }],
    })
    const result = message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim()
    if (result) return result
  } catch (e) {
    console.warn('Haiku failed, trying Sonnet:', e)
  }

  // 2. Sonnet fallback
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: SYSTEM,
      messages: [{ role: 'user', content: raw }],
    })
    const result = message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim()
    if (result) return result
  } catch (e) {
    console.warn('Sonnet failed, trying GPT-4o-mini:', e)
  }

  // 3. GPT-4o-mini — OpenAI fallback
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: raw },
      ],
    })
    const result = completion.choices[0]?.message?.content?.trim()
    if (result) return result
  } catch (e) {
    console.warn('GPT-4o-mini failed, returning raw:', e)
  }

  return raw
}

export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const audio = form.get('audio') as File
    if (!audio) return Response.json({ error: 'No audio' }, { status: 400 })

    const transcription = await openai.audio.transcriptions.create({
      file: audio,
      model: 'whisper-1',
      prompt: 'Torah, Talmud, Shabbat, Rashi, Rambam, Mishnah, Gemara, parasha, mitzvah, Hashem, Moshe, Avraham, Yitzchak, Yaakov, Hebrew, Aramaic, halacha, gematria, Zohar, Kabbalah, tefillin, mezuzah, kashrut, Pesach, Sukkot, Shavuot, Ben Ish Chai, Kaf HaChaim, Mishnah Berurah, Shulchan Aruch, Orach Chaim, Yoreh Deah, Choshen Mishpat, Sfat Emet, Nefesh HaChaim, Mesillat Yesharim, Chovot HaLevavot, Sefer HaChinuch, Maharal, Ramban, Nachmanides, Ramchal, Rabbi Moshe Chaim Luzzatto, Derech Hashem, Da\'at Tevunot, Ibn Ezra, Abarbanel, Ohr HaChaim, Alshich, Radak, Sforno, Tikunei Zohar, Sefer Yetzirah, Tanya, Likutei Amarim, Etz Chaim, Pardes Rimonim, Bereishit, Shemot, Vayikra, Bamidbar, Devarim, Tehillim, Mishlei, Kohelet, Eicha, Mispar Hechrachi, Atbash, zmanim, havdalah, Kiddush, Maariv, Shacharit, Mincha',
      language: 'en',
    })

    const raw = transcription.text?.trim() || ''
    if (!raw) return Response.json({ transcript: '' })

    const normalized = await normalizeTranscript(raw)
    return Response.json({ transcript: normalized, raw })
  } catch (err) {
    console.error('Transcribe error:', err)
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
