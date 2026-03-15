import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM = `You are a transcript normalizer for a Jewish learning voice app. You receive a short voice transcript (1-3 sentences max) and return ONLY the corrected transcript.

RULES:
- Return ONLY the corrected transcript text. Nothing else.
- Do NOT explain what you did
- Do NOT say "I can help if..." or "I don't have access to..."
- Do NOT add bullet points, options, or commentary
- Do NOT respond conversationally
- If the transcript is already correct, return it unchanged
- If you are unsure, return the original transcript unchanged

CORRECTIONS TO MAKE:
1. Fix mispronounced Hebrew names — e.g. "moshen" → "Moshe", "avrohom" → "Avraham", "bereishis" → "Bereishit", "shabbos" → "Shabbat", "bnai schai" → "Ben Ish Chai", "ramchal" → "Ramchal"
2. Add Hebrew in parentheses for key proper nouns — e.g. "Moshe (מֹשֶׁה)", "Torah (תּוֹרָה)"
3. Fix book names — "bereishis" → "Bereishit", "tehillim" → "Tehillim"
4. Fix rabbi names — "the rambam" → "the Rambam", "rav kook" → "Rav Kook"
5. Keep the meaning and intent exactly — only fix names, never rewrite the question

EXAMPLE INPUT: "what does the rambam say about teshuva"
EXAMPLE OUTPUT: "What does the Rambam say about teshuva (תְּשׁוּבָה)?"

EXAMPLE INPUT: "tell me about shabbos candles"
EXAMPLE OUTPUT: "Tell me about Shabbat candles."

EXAMPLE INPUT: "what is the daf yomi today"
EXAMPLE OUTPUT: "What is the Daf Yomi today?"`

function isSafeNormalization(raw: string, normalized: string): boolean {
  // If normalized is more than 2x the length of raw, Haiku went rogue
  if (normalized.length > raw.length * 2) return false
  // If it contains these phrases, it's a conversational response not a normalization
  const badPhrases = [
    'i can help', 'i don\'t have', 'i do not have', 'please provide',
    'could you', 'would you', 'let me know', 'happy to help',
    'normalization', 'transcript', 'clarify', 'confusion',
    'bullet', '- the', 'however,'
  ]
  const lower = normalized.toLowerCase()
  return !badPhrases.some(p => lower.includes(p))
}

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
    if (result && isSafeNormalization(raw, result)) return result
    console.warn('Haiku normalization failed safety check, trying Sonnet')
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
    if (result && isSafeNormalization(raw, result)) return result
    console.warn('Sonnet normalization failed safety check, trying GPT-4o-mini')
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
    if (result && isSafeNormalization(raw, result)) return result
  } catch (e) {
    console.warn('GPT-4o-mini failed, returning raw:', e)
  }

  // Safe fallback — return original
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
