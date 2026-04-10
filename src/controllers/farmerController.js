import User from '../models/User.js';
import CropBatch from '../models/CropBatch.js';
import multer from 'multer';
import { getChatResponse } from '../services/geminiService.js';
import { bhashiniAsr, bhashiniTts } from '../services/bhashiniService.js';
import axios from 'axios';
import FormData from 'form-data';

// ── Multer — store audio format in memory buffer ──────
export const upload = multer({ storage: multer.memoryStorage() });

/**
 * Robustly detects true localized language code directly from Unicode alphabet ranges.
 * Acts as an unbreakable TTS fallback if user db profiles drift.
 */
function detectTextLanguage(text) {
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
  if (/[\u0C80-\u0CFF]/.test(text)) return 'kn';
  if (/[\u0D00-\u0D7F]/.test(text)) return 'ml';
  if (/[\u0980-\u09FF]/.test(text)) return 'bn';
  if (/[\u0A80-\u0AFF]/.test(text)) return 'gu';
  if (/[\u0B00-\u0B7F]/.test(text)) return 'or';
  if (/[\u0A00-\u0A7F]/.test(text)) return 'pa';
  return 'en';
}

/**
 * POST /api/v1/farmer/chat
 * Multi-turn Gemini chatbot for farmer onboarding and assistance.
 * Persists chat history in MongoDB. Auto-triggers onboarding on data capture.
 */
export const chat = async (req, res, next) => {
  try {
    const { message, isVoiceInitiated = false } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Message is required',
      });
    }

    const farmer = await User.findById(req.user._id);
    if (!farmer) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // ── Send to Gemini with full chat history ────────
    const history = farmer.chatHistory || [];
    let aiResponse;

    try {
      const lang = farmer.preferredLanguage || 'en';
      aiResponse = await getChatResponse(history, message.trim(), lang);
    } catch (aiError) {
      console.error('❌ Gemini API error:', aiError.message);
      return res.status(502).json({
        success: false,
        error: `AI service error: ${aiError.message}`,
      });
    }

    // ── Persist both turns to chatHistory ─────────────
    farmer.chatHistory.push(
      { role: 'user', parts: [{ text: message.trim() }] },
      { role: 'model', parts: [{ text: aiResponse }] }
    );

    // ── Check for DATA_CAPTURE_COMPLETE marker ───────
    let onboardingData = null;
    let batchCreated = null;

    if (aiResponse.includes('[DATA_CAPTURE_COMPLETE]')) {
      try {
        const jsonMatch = aiResponse.match(
          /\[DATA_CAPTURE_COMPLETE\]\s*\n?\s*(\{[\s\S]*?\})/
        );

        if (jsonMatch && jsonMatch[1]) {
          onboardingData = JSON.parse(jsonMatch[1]);

          if (onboardingData.crops) {
            farmer.farmerProfile = farmer.farmerProfile || {};
            farmer.farmerProfile.crops = onboardingData.crops;
          }
          if (onboardingData.preferredLanguage) {
            farmer.preferredLanguage = onboardingData.preferredLanguage;
          }
          farmer.isOnboardingComplete = true;

          // Auto-initialize Stage 1 batch for primary crop
          if (onboardingData.crops && onboardingData.crops.length > 0) {
            const batchId = `CROP-${Date.now().toString().slice(-6)}`;
            const batch = await CropBatch.create({
              batchId,
              farmerId: farmer._id,
              speciesName: onboardingData.crops[0],
              cultivationDetails: {
                irrigationType: farmer.farmerProfile?.irrigationType || 'Unknown',
                soilType: 'Unknown', // Soil type is not captured anymore
                estimatedQuantityKg: onboardingData.estimatedQuantityKg || 0,
              },
              stages: [
                {
                  stageNumber: 1,
                  status: 'COMPLETED',
                  completedAt: new Date(),
                  geoTag: { lat: 0, lng: 0 },
                  photoIpfsCid: 'pending-photo-upload',
                },
              ],
              status: 'INITIATED',
            });

            batchCreated = {
              batchId: batch.batchId,
              speciesName: batch.speciesName,
              status: batch.status,
            };
          }
        }
      } catch (parseError) {
        console.error('⚠️ Failed to parse onboarding data:', parseError.message);
      }
    }

    await farmer.save();

    // ── Build response ───────────────────────────────
    const responseData = {
      reply: aiResponse.replace(/\[DATA_CAPTURE_COMPLETE\][\s\S]*$/, '').trim(),
      isOnboardingComplete: farmer.isOnboardingComplete,
      isVoiceInitiated: !!isVoiceInitiated,
    };

    if (onboardingData) {
      responseData.farmerProfile = farmer.farmerProfile;
    }

    if (batchCreated) {
      responseData.batchCreated = batchCreated;
    }

    // If voice-initiated, auto-generate TTS for the response
    if (isVoiceInitiated) {
      try {
        const { bhashiniTts } = await import('../services/bhashiniService.js');
        const trueLang = detectTextLanguage(responseData.reply);
        responseData.aiResponseAudio = await bhashiniTts(responseData.reply, trueLang);
      } catch (ttsErr) {
        console.error('⚠️ TTS generation skipped:', ttsErr.message);
      }
    }

    res.status(200).json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/farmer/chat/history
 * Returns the farmer's full chat history.
 */
export const getChatHistory = async (req, res, next) => {
  try {
    const farmer = await User.findById(req.user._id).select('chatHistory isOnboardingComplete farmerProfile');
    if (!farmer) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.status(200).json({
      success: true,
      data: {
        chatHistory: farmer.chatHistory.map((msg) => {
          const raw = msg.toObject ? msg.toObject() : msg;
          if (raw.role === 'model' && raw.parts && raw.parts.length > 0) {
            raw.parts[0].text = raw.parts[0].text.replace(/\[DATA_CAPTURE_COMPLETE\][\s\S]*$/, '').trim();
          }
          return raw;
        }),
        isOnboardingComplete: farmer.isOnboardingComplete,
        farmerProfile: farmer.farmerProfile || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/farmer/profile
 * Returns the logged-in farmer's profile, onboarding status, and latest batch info.
 */
export const getProfile = async (req, res, next) => {
  try {
    const farmer = await User.findById(req.user._id).select(
      'name email phone preferredLanguage farmerProfile isOnboardingComplete walletAddress createdAt'
    );
    if (!farmer) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Fetch most recent batch for this farmer
    const latestBatch = await CropBatch.findOne({ farmerId: farmer._id })
      .sort({ createdAt: -1 })
      .select('batchId speciesName status stages');

    res.status(200).json({
      success: true,
      data: {
        profile: {
          name: farmer.name,
          email: farmer.email,
          phone: farmer.phone,
          preferredLanguage: farmer.preferredLanguage,
          walletAddress: farmer.walletAddress,
          memberSince: farmer.createdAt,
        },
        farmerProfile: farmer.farmerProfile || null,
        isOnboardingComplete: farmer.isOnboardingComplete,
        latestBatch: latestBatch || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ── Export aliases for route naming consistency ──────────────
export { chat as handleChat };

/**
 * POST /api/v1/farmer/voice-chat
 * Voice-first chatbot: Bhashini ASR -> Gemini -> Bhashini TTS pipeline.
 */
export const voiceChat = async (req, res, next) => {
  try {
    let audioBase64 = '';

    if (req.file) {
      audioBase64 = req.file.buffer.toString('base64');
    } else if (req.body.audio) {
      audioBase64 = req.body.audio;
    } else {
      return res.status(400).json({ success: false, error: 'Audio file or base64 audio is required' });
    }

    const farmer = await User.findById(req.user._id);
    if (!farmer) return res.status(404).json({ success: false, error: 'User not found' });

    // Strictly synchronize voice/translation languages with backend ML profile
    const sourceLanguage = farmer.preferredLanguage || 'en';

    // 1. Import Bhashini helpers lazily to avoid module issues
    const { bhashiniAsr, bhashiniTts } = await import('../services/bhashiniService.js');

    // 2. ASR - Speech to Text
    let transcript = '';
    try {
      transcript = await bhashiniAsr(audioBase64, sourceLanguage);
    } catch (asrError) {
      return res.status(502).json({ success: false, error: asrError.message });
    }

    // 3. Gemini Chat
    const history = farmer.chatHistory || [];
    let aiResponse;
    try {
      aiResponse = await getChatResponse(history, transcript, sourceLanguage);
    } catch (aiError) {
      console.error('❌ Gemini API error:', aiError.message);
      return res.status(502).json({ success: false, error: `AI service error: ${aiError.message}` });
    }

    // 4. Persist both turns
    farmer.chatHistory.push(
      { role: 'user', parts: [{ text: transcript }] },
      { role: 'model', parts: [{ text: aiResponse }] }
    );

    // 5. Data Capture check + auto-batch creation
    let onboardingData = null;
    let batchCreated = null;

    if (aiResponse.includes('[DATA_CAPTURE_COMPLETE]')) {
      try {
        const jsonMatch = aiResponse.match(/\[DATA_CAPTURE_COMPLETE\]\s*\n?\s*(\{[\s\S]*?\})/);
        if (jsonMatch && jsonMatch[1]) {
          onboardingData = JSON.parse(jsonMatch[1]);
          farmer.farmerProfile = {
            farmSize: onboardingData.farmSize,
            location: onboardingData.location,
            soilType: onboardingData.soilType,
            irrigationType: onboardingData.irrigationType,
            crops: onboardingData.crops || [],
          };
          farmer.isOnboardingComplete = true;

          if (onboardingData.crops?.length > 0) {
            const batchId = `CROP-${Date.now().toString().slice(-6)}`;
            const batch = await CropBatch.create({
              batchId,
              farmerId: farmer._id,
              speciesName: onboardingData.crops[0],
              cultivationDetails: {
                irrigationType: onboardingData.irrigationType,
                soilType: onboardingData.soilType,
                estimatedQuantityKg: 0,
              },
              stages: [{ stageNumber: 1, status: 'COMPLETED', completedAt: new Date(), geoTag: { lat: 0, lng: 0 }, photoIpfsCid: 'pending' }],
              status: 'INITIATED',
            });
            batchCreated = { batchId: batch.batchId, speciesName: batch.speciesName, status: batch.status };
          }
        }
      } catch (parseError) {
        console.error('⚠️ Failed to parse onboarding data:', parseError.message);
      }
    }

    await farmer.save();

    const cleanAiResponse = aiResponse.replace(/\[DATA_CAPTURE_COMPLETE\][\s\S]*$/, '').trim();

    // 6. TTS - Text to Speech
    let aiResponseAudio = null;
    try {
      const trueLang = detectTextLanguage(cleanAiResponse);
      aiResponseAudio = await bhashiniTts(cleanAiResponse, trueLang);
    } catch (ttsError) {
      console.error('⚠️ TTS Warning:', ttsError.message);
    }

    const responseData = {
      transcript,
      aiResponseText: cleanAiResponse,
      aiResponseAudio,
      isDataComplete: farmer.isOnboardingComplete,
    };

    if (onboardingData) responseData.farmerProfile = farmer.farmerProfile;
    if (batchCreated) responseData.batchCreated = batchCreated;

    res.status(200).json({ success: true, data: responseData });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/farmer/batches
 * Returns all crop batches belonging to the logged-in farmer.
 */
export const getMyBatches = async (req, res, next) => {
  try {
    const batches = await CropBatch.find({ farmerId: req.user._id })
      .sort({ createdAt: -1 })
      .select('batchId speciesName status stages createdAt cultivationDetails');
    res.status(200).json({ success: true, data: batches });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/v1/farmer/profile/update
 * Allows farmer to update all profile fields EXCEPT name.
 */
export const updateProfile = async (req, res, next) => {
  try {
    const { phone, email, farmSize, irrigationType, location, preferredLanguage } = req.body;

    const farmer = await User.findById(req.user._id);
    if (!farmer) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Update top-level fields (name is intentionally excluded)
    if (phone) farmer.phone = phone;
    if (email) farmer.email = email.toLowerCase();
    if (preferredLanguage) farmer.preferredLanguage = preferredLanguage;

    // Update farmerProfile sub-document
    if (!farmer.farmerProfile) {
      farmer.farmerProfile = { farmSize: '', location: '', soilType: '', irrigationType: '', crops: [] };
    }
    if (farmSize !== undefined) farmer.farmerProfile.farmSize = farmSize;
    if (irrigationType !== undefined) farmer.farmerProfile.irrigationType = irrigationType;
    if (location !== undefined) farmer.farmerProfile.location = location;

    await farmer.save();

    res.status(200).json({
      success: true,
      data: {
        profile: {
          name: farmer.name,
          phone: farmer.phone,
          email: farmer.email,
          preferredLanguage: farmer.preferredLanguage,
        },
        farmerProfile: farmer.farmerProfile,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/farmer/dashboard
 * Returns analytics data for the farmer's dashboard.
 * Combines real batch data with seeded monthly trends.
 */
export const getDashboard = async (req, res, next) => {
  try {
    const farmerId = req.user._id;

    // Real data — batch counts by status
    const batches = await CropBatch.find({ farmerId });
    const statusCounts = {};
    batches.forEach((b) => {
      statusCounts[b.status] = (statusCounts[b.status] || 0) + 1;
    });

    // Total completed stages across all batches
    let completedStages = 0;
    batches.forEach((b) => {
      b.stages.forEach((s) => {
        if (s.status === 'COMPLETED') completedStages++;
      });
    });

    // Fetch OpenWeatherMap Weather News
    let weatherNews = null;
    try {
      const { lat, lon } = req.query;
      let weatherUrlParams = '';

      if (lat && lon) {
        weatherUrlParams = `lat=${lat}&lon=${lon}`;
      } else {
        const farmer = await User.findById(farmerId).select('farmerProfile');
        const loc = farmer?.farmerProfile?.location || 'Hyderabad';
        weatherUrlParams = `q=${loc}`;
      }

      const weatherRes = await axios.get(
        `https://api.openweathermap.org/data/2.5/weather?${weatherUrlParams}&appid=${process.env.WEATHER_API}&units=metric`
      );
      weatherNews = {
        location: weatherRes.data.name,
        temp: weatherRes.data.main.temp,
        description: weatherRes.data.weather[0].description,
        humidity: weatherRes.data.main.humidity,
        icon: weatherRes.data.weather[0].icon,
      };
    } catch (weatherErr) {
      console.error('⚠️ Weather API skipped or failed:', weatherErr.message);
    }

    // Crop species distribution
    const speciesCounts = {};
    batches.forEach((b) => {
      speciesCounts[b.speciesName] = (speciesCounts[b.speciesName] || 0) + 1;
    });

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalBatches: batches.length,
          activeBatches: batches.filter((b) => !['SOLD', 'LAB_TESTED'].includes(b.status)).length,
          completedStages,
          harvestedBatches: batches.filter((b) => b.status === 'HARVESTED').length,
        },
        statusDistribution: statusCounts,
        speciesDistribution: speciesCounts,
        weatherNews: weatherNews,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/farmer/tts
 * On-demand TTS generation for text-initiated messages.
 */
export const generateTts = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: 'Text is required' });
    }

    const farmer = await User.findById(req.user._id).select('preferredLanguage');
    if (!farmer) return res.status(404).json({ success: false, error: 'User not found' });

    const lang = farmer.preferredLanguage || 'en';
    const { bhashiniTts } = await import('../services/bhashiniService.js');
    const audioBase64 = await bhashiniTts(text.trim(), lang);

    res.status(200).json({
      success: true,
      data: { audioBase64 },
    });
  } catch (error) {
    console.error('❌ On-demand TTS Error:', error.message);
    next(error);
  }
};

/**
 * Helper: Pin a file buffer to IPFS via Pinata
 */
const pinToPinata = async (fileBuffer, filename) => {
  const form = new FormData();
  form.append('file', fileBuffer, { filename });
  const metadata = JSON.stringify({ name: `AyuSethu-${filename}` });
  form.append('pinataMetadata', metadata);
  const response = await axios.post(
    'https://api.pinata.cloud/pinning/pinFileToIPFS',
    form,
    {
      maxBodyLength: Infinity,
      headers: {
        ...form.getHeaders(),
        pinata_api_key: process.env.PINATA_API_KEY,
        pinata_secret_api_key: process.env.PINATA_SECRET_KEY,
      },
    }
  );
  return response.data.IpfsHash;
};

/**
 * POST /api/v1/farmer/batch/:batchId/stage/:stageNumber
 * Allows farmer to upload stage progress photo with geo-tag directly from mobile device.
 */
export const completeStage = async (req, res, next) => {
  try {
    const { batchId, stageNumber } = req.params;
    const { lat, lng } = req.body;
    const stageNum = parseInt(stageNumber, 10);

    if (stageNum < 2 || stageNum > 5) {
      return res.status(400).json({ success: false, error: 'Cannot manually override stage 1.' });
    }

    const batch = await CropBatch.findOne({ batchId, farmerId: req.user._id });
    if (!batch) {
      return res.status(404).json({ success: false, error: 'Crop batch not found or unauthorized' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'A photo is required for stage completion' });
    }

    let photoCid;
    try {
      photoCid = await pinToPinata(req.file.buffer, `stage${stageNum}-${batchId}.jpg`);
    } catch (pinErr) {
      return res.status(502).json({ success: false, error: 'IPFS upload failed' });
    }

    // Upsert the stage in the array
    const existingIndex = batch.stages.findIndex((s) => s.stageNumber === stageNum);
    const stageData = {
      stageNumber: stageNum,
      status: 'COMPLETED',
      completedAt: new Date(),
      geoTag: { lat: parseFloat(lat) || 0, lng: parseFloat(lng) || 0 },
      photoIpfsCid: photoCid,
    };

    if (existingIndex > -1) {
      batch.stages[existingIndex] = stageData;
    } else {
      batch.stages.push(stageData);
    }
    
    // Auto-advance batch status if hitting stage 5
    if (stageNum === 5 && batch.status === 'INITIATED') {
      batch.status = 'GROWING'; // Or whatever intermediate status makes sense before harvest/ML check
    }

    await batch.save();
    
    res.status(200).json({
      success: true,
      data: batch,
    });
  } catch (error) {
    next(error);
  }
};
