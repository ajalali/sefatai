// Sefatai — voice configuration
// Voice: Will (bIHbv24MWmeRgasZH58o) — pending voice clone

export const SEFATAI_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'bIHbv24MWmeRgasZH58o'

export const VOICE_SETTINGS = {
  stability: 0.75,        // higher = consistent tone, fewer breath artifacts
  similarity_boost: 0.75, // lower = less exaggerated characteristics, cleaner S sounds
  style: 0.15,            // low = minimal stylistic flourish, no lispy S, natural delivery
  use_speaker_boost: true,
}

export const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL_ID || 'eleven_v3'
