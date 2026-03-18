import multer from 'multer';

// ── Multer — store audio/image in memory buffer ──────
const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /api/v1/farmer/voice-intent
 * Accepts audio blob, stubs Bhashini ASR parsing.
 */
export const processVoiceIntent = async (req, res, next) => {
  try {
    // In production: forward req.file.buffer to Bhashini ASR → NLP parse
    const stubParsedIntent = {
      crop: 'Ashwagandha',
      scheduledDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      language: req.user.preferredLanguage || 'en',
      rawTranscription: 'I want to initiate an Ashwagandha crop next Tuesday',
    };

    // Stub TTS confirmation audio
    const stubTtsResponse = {
      audioUrl: null,
      message: `Crop initiation for ${stubParsedIntent.crop} scheduled on ${stubParsedIntent.scheduledDate}`,
    };

    res.status(200).json({
      success: true,
      data: {
        parsedIntent: stubParsedIntent,
        ttsConfirmation: stubTtsResponse,
        note: '[STUB] Bhashini ASR/TTS integration pending',
      },
    });
  } catch (error) {
    next(error);
  }
};

export { upload };
