// api/evaluate-answer.js

const {
  AI_PROVIDERS,
  MAX_RETRIES,
  callAIProvider,
  parseAIJSON,
} = require('./_lib/ai-utils');

/**
 * Membangun prompt untuk evaluasi jawaban esai.
 */
function buildEvaluationPrompt(question, userAnswer) {
  return `Kamu adalah AI penilai jawaban esai.\n` +
    `Pertanyaan: ${question}\n` +
    `Jawaban siswa: ${userAnswer}\n\n` +
    `Evaluasi jawaban siswa berdasarkan kesesuaian dengan pertanyaan, konsep, ketepatan, kelengkapan, dan poin penting.\n` +
    `Berikan nilai skor 0-100.\n` +
    `Berikan feedback yang mendidik.\n` +
    `Sertakan jawaban ideal (idealAnswer).\n` +
    `Sertakan poin-poin yang kurang (missingPoints) sebagai array string.\n\n` +
    `Format output harus JSON murni tanpa markdown, dengan struktur:\n` +
    `{\n` +
    `  "score": 85,\n` +
    `  "isCorrect": true,\n` +
    `  "feedback": "...",\n` +
    `  "idealAnswer": "...",\n` +
    `  "missingPoints": ["...", "..."]\n` +
    `}\n\n` +
    `Tulis JSON sekarang.`;
}

/**
 * Validasi hasil evaluasi.
 */
function validateEvaluation(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.score !== 'number' || data.score < 0 || data.score > 100) return false;
  if (typeof data.isCorrect !== 'boolean') return false;
  if (typeof data.feedback !== 'string') return false;
  if (typeof data.idealAnswer !== 'string') return false;
  if (!Array.isArray(data.missingPoints)) return false;
  for (const point of data.missingPoints) {
    if (typeof point !== 'string') return false;
  }
  return true;
}

/**
 * Mencoba evaluasi dengan fallback 4 AI.
 */
async function evaluateWithFallback(prompt) {
  for (const provider of AI_PROVIDERS) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const text = await callAIProvider(provider, prompt);
        if (!text) continue;

        const data = parseAIJSON(text);
        if (validateEvaluation(data)) {
          console.log(`Evaluasi berhasil dengan ${provider.name} attempt ${attempt + 1}`);
          return data;
        }

        console.warn(`Evaluasi tidak valid dari ${provider.name} attempt ${attempt + 1}`);
      } catch (error) {
        console.error(`Evaluasi error dengan ${provider.name} attempt ${attempt + 1}: ${error.message}`);
      }
    }
  }
  return null;
}

/**
 * Serverless function untuk evaluasi jawaban esai.
 */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const { question, userAnswer } = body;

    if (!question || typeof question !== 'string' || question.trim() === '') {
      return res.status(400).json({ error: 'Pertanyaan tidak valid' });
    }
    if (typeof userAnswer !== 'string' || userAnswer.trim() === '') {
      return res.status(400).json({ error: 'Jawaban tidak boleh kosong' });
    }

    const prompt = buildEvaluationPrompt(question, userAnswer);
    const evaluation = await evaluateWithFallback(prompt);

    if (!evaluation) {
      throw new Error('Semua provider gagal mengevaluasi');
    }

    return res.status(200).json({
      success: true,
      evaluation,
    });
  } catch (error) {
    console.error('Evaluate answer error:', error);
    return res.status(500).json({
      error: 'Gagal mengevaluasi jawaban. Silakan coba lagi.',
    });
  }
};