// api/generate-quiz.js

const {
  AI_PROVIDERS,
  BATCH_SIZE,
  MAX_RETRIES,
  callAIProvider,
  parseAIJSON,
  validateQuizBatch,
  shuffleOptions,
} = require('./_lib/ai-utils');

/**
 * Membangun prompt internal untuk pembuatan soal.
 */
function buildQuizPrompt(topic, instruction, batchCount, difficulty, batchIndex, totalCount) {
  let prompt = `Kamu adalah AI pembuat soal ujian profesional.\n`;
  prompt += `Materi: ${topic}\n`;
  if (instruction && instruction.trim()) {
    prompt += `Instruksi tambahan: ${instruction.trim()}\n`;
  }
  prompt += `Tingkat kesulitan: ${difficulty}\n`;
  if (batchIndex === 0) {
    prompt += `Total soal yang diminta: ${totalCount}\n`;
  }
  prompt += `Sekarang buat ${batchCount} soal (batch ke-${batchIndex + 1}).\n`;
  prompt += `Jenis soal: campuran pilihan ganda dan esai. Jangan semua pilihan ganda atau semua esai. Komposisi otomatis.\n`;
  prompt += `Setiap soal pilihan ganda harus memiliki tepat 4 pilihan (A, B, C, D).\n`;
  prompt += `Jawaban benar harus diacak posisinya, jangan selalu A.\n`;
  prompt += `Setiap pilihan harus memiliki explanation (penjelasan mengapa pilihan tersebut benar/salah).\n`;
  prompt += `Setiap soal harus memiliki explanation (pembahasan).\n`;
  prompt += `Soal esai harus memiliki idealAnswer.\n`;
  prompt += `Jangan membuat soal yang duplikat atau mirip dengan soal sebelumnya.\n`;
  prompt += `Gunakan bahasa yang sesuai dengan materi dan mudah dipahami.\n`;
  prompt += `Output harus berupa JSON murni tanpa markdown, tanpa teks tambahan di luar JSON.\n`;
  prompt += `Format JSON yang diharapkan:\n`;
  prompt += `{\n  "questions": [\n    {\n      "id": 1,\n      "type": "multiple_choice",\n      "question": "Pertanyaan...",\n      "options": [\n        {"text": "Pilihan A", "explanation": "Penjelasan..."},\n        {"text": "Pilihan B", "explanation": "Penjelasan..."},\n        {"text": "Pilihan C", "explanation": "Penjelasan..."},\n        {"text": "Pilihan D", "explanation": "Penjelasan..."}\n      ],\n      "correctAnswer": 0,\n      "explanation": "Pembahasan..."\n    },\n    {\n      "id": 2,\n      "type": "essay",\n      "question": "Pertanyaan esai...",\n      "idealAnswer": "Jawaban ideal...",\n      "explanation": "Pembahasan..."\n    }\n  ]\n}\n`;
  prompt += `Untuk multiple_choice, correctAnswer adalah index (0=A, 1=B, 2=C, 3=D).\n`;
  prompt += `Pastikan jumlah soal dalam array questions tepat ${batchCount}.\n`;
  prompt += `Tuliskan JSON sekarang.`;
  return prompt;
}

/**
 * Mencoba generate satu batch dengan fallback 4 AI.
 * Mengembalikan data batch yang valid atau null jika semua gagal.
 */
async function generateBatchWithFallback(prompt, batchCount) {
  for (const provider of AI_PROVIDERS) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const text = await callAIProvider(provider, prompt);
        if (!text) continue;

        const data = parseAIJSON(text);
        if (validateQuizBatch(data, batchCount)) {
          // Acak pilihan ganda
          data.questions = data.questions.map(q => shuffleOptions(q));
          console.log(`Batch berhasil dengan ${provider.name} attempt ${attempt + 1}`);
          return data;
        }

        console.warn(`Batch tidak valid dari ${provider.name} attempt ${attempt + 1}`);
      } catch (error) {
        console.error(`Batch error dengan ${provider.name} attempt ${attempt + 1}: ${error.message}`);
      }
    }
  }
  return null;
}

/**
 * Serverless function untuk generate quiz.
 */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const topic = body.topic;
    const instruction = body.instruction || '';
    const count = parseInt(body.count, 10);
    const difficulty = body.difficulty;

    // Validasi input
    if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
      return res.status(400).json({ error: 'Materi wajib diisi' });
    }
    if (!Number.isInteger(count) || count <= 0) {
      return res.status(400).json({ error: 'Jumlah soal harus angka positif' });
    }
    const allowedDifficulties = ['Mudah', 'Sedang', 'Sulit', 'Sangat Sulit'];
    if (!allowedDifficulties.includes(difficulty)) {
      return res.status(400).json({ error: 'Tingkat kesulitan tidak valid' });
    }

    const allQuestions = [];
    let remaining = count;
    let batchIndex = 0;

    while (remaining > 0) {
      const batchCount = Math.min(BATCH_SIZE, remaining);
      console.log(`Membuat batch ${batchIndex + 1} (${batchCount} soal)...`);

      const prompt = buildQuizPrompt(topic, instruction, batchCount, difficulty, batchIndex, count);
      const batchData = await generateBatchWithFallback(prompt, batchCount);

      if (!batchData || !batchData.questions) {
        throw new Error(`Semua provider AI gagal untuk batch ${batchIndex + 1}`);
      }

      allQuestions.push(...batchData.questions);
      remaining -= batchCount;
      batchIndex++;
    }

    return res.status(200).json({
      success: true,
      quiz: {
        topic: topic,
        difficulty: difficulty,
        total: count,
        questions: allQuestions,
      },
    });
  } catch (error) {
    console.error('Generate quiz error:', error);
    return res.status(500).json({
      error: 'Semua penyedia AI sedang tidak dapat digunakan. Silakan coba lagi beberapa saat.',
    });
  }
};