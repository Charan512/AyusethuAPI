import axios from 'axios';

const SYSTEM_INSTRUCTION = `You are the AyuSethu Farmer Assistant — a warm, professional agricultural chatbot for a crop supply chain platform.

TONE: Farm-friendly, supportive, concise. Use simple language. Greet warmly on first message.

PHASE 1 — NEW FARMER ONBOARDING:
If the user is new (empty chat history), gather the following information continuously:
1. Ask them which language they prefer to communicate in!
2. What crops or plants they currently grow or want to grow.
3. The estimated quantity they expect to harvest (in Kg, tons, or quintals).

Be conversational. 

PHASE 2 — RETURNING FARMER:
If the user already has profile data, help with:
- Starting a new crop batch
- Checking batch status
- General farming queries about crops

CRITICAL RULE — DATA CAPTURE:
Once you have discovered their desired crops AND their estimated harvest quantity, end your message with EXACTLY this format:

[DATA_CAPTURE_COMPLETE]
{"crops":["crop1"],"estimatedQuantityKg":500,"preferredLanguage":"te"}

The JSON must be valid and on a single line immediately after the marker. Convert tons/quintals directly into Kg integers. Do NOT include the marker until you have BOTH the crop and quantity.`;

/**
 * Get a chat response from Groq using conversation history.
 * @param {Array} history - Previous chat turns
 * @param {string} newMessage - The user's new message
 * @param {string} [language] - Optional language code to force the response language
 * @returns {string} The model's response text
 */
export const getChatResponse = async (history, newMessage, language = 'en') => {
  const messages = [
    { role: 'system', content: SYSTEM_INSTRUCTION }
  ];

  // Map Mongoose-style Gemini history to OpenAI/Groq array format
  if (Array.isArray(history)) {
    history.forEach(msg => {
      let text = '';
      if (Array.isArray(msg.parts)) {
        text = msg.parts.map(p => p.text).join(' ');
      } else {
        text = msg.text || '';
      }
      messages.push({
        role: msg.role === 'model' ? 'assistant' : 'user',
        content: text,
      });
    });
  }

  // Softly enforce language but allow organic mid-chat switching
  const languagePrompt = `\n\n[SYSTEM INSTRUCTION: Your default language is '${language}'. However, if the user explicitly asks you to speak in a different language, or naturally switches the conversation language, you MUST dynamically match their new language preference without arguing.]`;
  messages.push({
    role: 'user',
    content: newMessage + languagePrompt,
  });

  let responseData;
  try {
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: messages,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    responseData = res.data;
  } catch (err) {
    if (err.response && err.response.status === 503) {
      console.warn('⚠️ Groq capacity drop. Sleeping 2s and retrying...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      const res2 = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        { model: 'llama-3.3-70b-versatile', messages },
        { headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
      );
      responseData = res2.data;
    } else {
      console.error('Groq API Error:', err.response ? err.response.data : err.message);
      throw err;
    }
  }

  return responseData.choices[0].message.content;
};

// Alias so controller can import as handleChat or getChatResponse
export { getChatResponse as handleChat };
