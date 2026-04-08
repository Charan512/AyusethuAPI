import User from '../models/User.js';
import CropBatch from '../models/CropBatch.js';
import multer from 'multer';
import { getChatResponse } from '../services/geminiService.js';
import { bhashiniAsr, bhashiniTts } from '../services/bhashiniService.js';

// ── Multer — store audio format in memory buffer ──────
export const upload = multer({ storage: multer.memoryStorage() });

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
      aiResponse = await getChatResponse(history, message.trim());
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

          // Save farmer profile
          farmer.farmerProfile = {
            farmSize: onboardingData.farmSize,
            location: onboardingData.location,
            soilType: onboardingData.soilType,
            irrigationType: onboardingData.irrigationType,
            crops: onboardingData.crops || [],
          };
          farmer.isOnboardingComplete = true;

          // Auto-initialize Stage 1 batch for primary crop
          if (onboardingData.crops && onboardingData.crops.length > 0) {
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
        const lang = farmer.preferredLanguage || 'en';
        responseData.aiResponseAudio = await bhashiniTts(responseData.reply, lang);
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
        chatHistory: farmer.chatHistory,
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
      'name phone preferredLanguage farmerProfile isOnboardingComplete walletAddress createdAt'
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
    const { sourceLanguage = 'en' } = req.body;
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
      aiResponseAudio = await bhashiniTts(cleanAiResponse, sourceLanguage);
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

    // Seeded monthly activity (last 6 months)
    const months = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'];
    const monthlyData = months.map((m, i) => ({
      month: m,
      batchesCreated: Math.max(1, batches.length > 0 ? Math.floor(Math.random() * 5) + 1 : [2, 3, 1, 4, 2, 5][i]),
      stagesCompleted: Math.max(1, Math.floor(Math.random() * 8) + 2),
    }));

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
        monthlyActivity: monthlyData,
      },
    });
  } catch (error) {
    next(error);
  }
};
