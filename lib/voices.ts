export const SEFATAI_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'bIHbv24MWmeRgasZH58o'

export const VOICE_SETTINGS = {
  stability: 0.90,        // very high = rock solid, zero breath variation
  similarity_boost: 0.60, // lower = pulls less hard on voice characteristics, reduces lisp
  style: 0.00,            // zero = no stylistic exaggeration whatsoever
  use_speaker_boost: true,
}

export const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL_ID || 'eleven_v3'
