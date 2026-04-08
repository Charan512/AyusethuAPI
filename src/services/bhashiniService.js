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
    const response = await axios.post(
      BHASHINI_PIPELINE_URL,
      {
        pipelineTasks: [
          {
            taskType: 'asr',
            config: {
              language: { sourceLanguage }
            }
          }
        ],
        inputData: { audio: [{ audioContent: audioBase64 }] }
      },
      {
        headers: {
          Authorization: process.env.BHASHINI_INFERENCE_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const asrOutput = response.data?.pipelineResponse?.[0]?.output?.[0]?.source;
    if (!asrOutput) throw new Error("Invalid ASR payload returned");
    
    return asrOutput;
  } catch (error) {
    console.error('❌ Bhashini ASR Error:', error.response?.data || error.message);
    throw new Error('Speech-to-Text conversion failed on Bhashini pipeline');
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
    const response = await axios.post(
      BHASHINI_PIPELINE_URL,
      {
        pipelineTasks: [
          {
            taskType: 'tts',
            config: {
              language: { sourceLanguage: targetLanguage }
            }
          }
        ],
        inputData: { input: [{ source: text }] }
      },
      {
        headers: {
          Authorization: process.env.BHASHINI_INFERENCE_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const audioOutput = response.data?.pipelineResponse?.[0]?.audio?.[0]?.audioContent;
    if (!audioOutput) throw new Error("Invalid TTS payload returned");
    
    return audioOutput;
  } catch (error) {
    console.error('❌ Bhashini TTS Error:', error.response?.data || error.message);
    throw new Error('Text-to-Speech conversion failed on Bhashini pipeline');
  }
};
