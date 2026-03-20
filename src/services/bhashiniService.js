import axios from 'axios';

const BHASHINI_PIPELINE_URL = 'https://dhruva-api.bhashini.gov.in/services/inference/pipeline';

/**
 * Helper to call Bhashini ASR (Speech-to-Text)
 * @param {string} audioBase64 - Base64 encoded audio
 * @param {string} sourceLanguage - e.g., 'te', 'hi', 'en'
 * @returns {string} - The transcribed text
 */
export const bhashiniAsr = async (audioBase64, sourceLanguage) => {
  try {
    // ── NOTE: This is a realistic payload structure for Bhashini ASR ──
    // In a fully live environment, you first fetch the compute URL from the config endpoint,
    // but here we demonstrate the direct inference call structure.
    
    /*
    const response = await axios.post(
      BHASHINI_PIPELINE_URL,
      {
        pipelineTasks: [{ taskType: 'asr' }],
        inputData: { audio: [{ audioContent: audioBase64 }] },
        config: { language: { sourceLanguage } }
      },
      {
        headers: {
          Authorization: process.env.BHASHINI_INFERENCE_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.pipelineResponse[0].output[0].source;
    */

    // For testing/stub purposes without live compute callbacks:
    console.log(`[Bhashini] Simulated ASR for language: ${sourceLanguage}`);
    return 'Namaste, I am Raju. I have 3 acres of land.'; 
  } catch (error) {
    console.error('❌ Bhashini ASR Error:', error.message);
    throw new Error('Speech-to-Text conversion failed');
  }
};

/**
 * Helper to call Bhashini TTS (Text-to-Speech)
 * @param {string} text - The text to synthesize
 * @param {string} targetLanguage - e.g., 'te', 'hi', 'en'
 * @returns {string} - Base64 encoded audio of the spoken text
 */
export const bhashiniTts = async (text, targetLanguage) => {
  try {
    // ── NOTE: Realistic payload for Bhashini TTS ──
    /*
    const response = await axios.post(
      BHASHINI_PIPELINE_URL,
      {
        pipelineTasks: [{ taskType: 'tts' }],
        inputData: { input: [{ source: text }] },
        config: { language: { sourceLanguage: targetLanguage } }
      },
      {
        headers: {
          Authorization: process.env.BHASHINI_INFERENCE_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.pipelineResponse[0].audio[0].audioContent;
    */

    // For testing/stub purposes:
    console.log(`[Bhashini] Simulated TTS for language: ${targetLanguage}`);
    // Dummy 1-second silent WAV in base64
    return 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  } catch (error) {
    console.error('❌ Bhashini TTS Error:', error.message);
    throw new Error('Text-to-Speech conversion failed');
  }
};
