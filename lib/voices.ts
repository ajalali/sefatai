// Sefatai — voice configuration
// Flash for speed/cost on regular answers
// v3 for recitations (switched automatically in chain/route.ts)

export const SEFATAI_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'bIHbv24MWmeRgasZH58o'

export const VOICE_SETTINGS = {
  stability: 0.90,        // very high = consistent tone, no breath artifacts
  similarity_boost: 0.60, // lower = less exaggerated characteristics, cleaner S sounds
  style: 0.00,            // zero = no stylistic exaggeration
  use_speaker_boost: true,
}

export const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2_5'
