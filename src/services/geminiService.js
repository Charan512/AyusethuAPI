import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_INSTRUCTION = `You are the AyuSethu Farmer Assistant — a warm, professional agricultural chatbot for a medicinal plant supply chain platform.

TONE: Farm-friendly, supportive, concise. Use simple language. Greet warmly on first message.

PHASE 1 — NEW FARMER ONBOARDING:
If the user is new (empty chat history), gather the following information one or two questions at a time:
1. Farm Size (e.g., "2 acres", "5 hectares")
2. Location (village/district/state)
3. Soil Type (e.g., laterite, alluvial, black cotton, red)
4. Irrigation Type (e.g., rain-fed, drip, canal, borewell)
5. What medicinal plants they grow or want to grow

Be conversational. Do NOT ask all questions at once. Guide them naturally.

PHASE 2 — RETURNING FARMER:
If the user already has profile data, help with:
- Starting a new crop batch
- Checking batch status
- General farming queries about medicinal plants

CRITICAL RULE — DATA CAPTURE:
Once you have ALL five pieces of information (farm size, location, soil type, irrigation, crops), end your message with EXACTLY this format:

[DATA_CAPTURE_COMPLETE]
{"farmSize":"value","location":"value","soilType":"value","irrigationType":"value","crops":["crop1","crop2"]}

The JSON must be valid and on a single line immediately after the marker. Do NOT include the marker until you have ALL data.`;

/**
 * Get a chat response from Gemini using conversation history.
 * @param {Array} history - Previous chat turns in Gemini format
 * @param {string} newMessage - The user's new message
 * @param {string} [language] - Optional language code to force the response language
 * @returns {string} The model's response text
 */
export const getChatResponse = async (history, newMessage, language = 'en') => {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: SYSTEM_INSTRUCTION,
  });

  const chat = model.startChat({
    history: history || [],
  });
  
  // Force Gemini to respond in the required language
  const languagePrompt = `\n\n[SYSTEM INSTRUCTION: You MUST reply entirely in the language corresponding to language code '${language}'.]`;
  const finalMessage = newMessage + languagePrompt;

  const result = await chat.sendMessage(finalMessage);
  return result.response.text();
};

// Alias so controller can import as handleChat or getChatResponse
export { getChatResponse as handleChat };
