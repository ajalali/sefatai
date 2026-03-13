// Sefatai — single voice config
// Replace SEFATAI_VOICE_ID with your chosen ElevenLabs voice ID

export const SEFATAI_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'YOUR_VOICE_ID_HERE'

export const VOICE_SETTINGS = {
  stability: 0.50,
  similarity_boost: 0.80,
  style: 0.5,
  use_speaker_boost: true,
}

export const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2_5'
