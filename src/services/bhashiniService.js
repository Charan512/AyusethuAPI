import axios from 'axios';

const CONFIG_URL = 'https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline';

async function getDynamicBhashiniTokens(taskType, sourceLanguage) {
  const payload = {
    pipelineTasks: [{ taskType, config: { language: { sourceLanguage } } }],
    pipelineRequestConfig: { pipelineId: "64392f96daac500b55c543cd" }
  };
  const response = await axios.post(CONFIG_URL, payload, {
    headers: {
      userID: process.env.BHASHINI_USER_ID,
      ulcaApiKey: process.env.BHASHINI_UDYAT_KEY,
      'Content-Type': 'application/json'
    }
  });
  
  const endpointObj = response.data.pipelineInferenceAPIEndPoint;
  return {
    callbackUrl: endpointObj.callbackUrl,
    inferenceKey: endpointObj.inferenceApiKey.value,
    serviceId: response.data.pipelineResponseConfig[0].config[0].serviceId
  };
}

export const bhashiniAsr = async (audioBase64, sourceLanguage) => {
  try {
    const { callbackUrl, inferenceKey, serviceId } = await getDynamicBhashiniTokens('asr', sourceLanguage);

    // Strip any generic Data URI prefix so Bhashini doesn't misidentify it as a fetch link (DHRUVA-116)
    const cleanBase64 = audioBase64.replace(/^data:audio\/\w+;base64,/, '');

    const payload = {
      pipelineTasks: [{
        taskType: 'asr',
        config: {
          language: { sourceLanguage },
          serviceId: serviceId,
          audioFormat: 'wav',
          samplingRate: 16000
        }
      }],
      inputData: { audio: [{ audioContent: cleanBase64 }] }
    };

    const response = await axios.post(callbackUrl, payload, {
      headers: {
        Authorization: inferenceKey,
        'Content-Type': 'application/json'
      }
    });

    const asrOutput = response.data?.pipelineResponse?.[0]?.output?.[0]?.source;
    if (!asrOutput) throw new Error("Invalid ASR payload returned");
    return asrOutput;
  } catch (error) {
    console.error('❌ Bhashini ASR Error:', error.response?.data || error.message);
    throw new Error('Speech-to-Text conversion failed on Bhashini pipeline');
  }
};

export const bhashiniTts = async (text, targetLanguage) => {
  try {
    const { callbackUrl, inferenceKey, serviceId } = await getDynamicBhashiniTokens('tts', targetLanguage);

    const payload = {
      pipelineTasks: [{
        taskType: 'tts',
        config: {
          language: { sourceLanguage: targetLanguage },
          serviceId: serviceId,
          gender: "female",
          audioFormat: "mp3"
        }
      }],
      inputData: { input: [{ source: text }] }
    };

    const response = await axios.post(callbackUrl, payload, {
      headers: {
        Authorization: inferenceKey,
        'Content-Type': 'application/json'
      }
    });

    const audioOutput = response.data?.pipelineResponse?.[0]?.audio?.[0]?.audioContent;
    if (!audioOutput) throw new Error("Invalid TTS payload returned");
    return audioOutput;
  } catch (error) {
    console.error('❌ Bhashini TTS Error:', error.response?.data || error.message);
    throw new Error('Text-to-Speech conversion failed on Bhashini pipeline');
  }
};
