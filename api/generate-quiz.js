// api/generate-quiz.js
// Vercel Serverless Function
// Endpoint: /api/generate-quiz

const AI_PROVIDERS = [
  { name: 'gemini', call: callGemini },
  { name: 'claude', call: callClaude },
  { name: 'blackbox', call: callBlackbox },
  { name: 'deepseak', call: callDeepseak }
];

const BATCH_SIZE = 10; // soal per batch, agar respons cepat dan tidak timeout
const MAX_RETRIES = 1; // retry per provider sebelum pindah

/* ==================== AI PROVIDERS ADAPTERS ==================== */

async function callGemini(prompt) {
  const url = `https://api-faa.my.id/faa/gemini-ai?text=${encodeURIComponent(prompt)}`;
  return await fetchAI(url, 'Gemini');
}

async function callClaude(prompt) {
  const url = `https://api-faa.my.id/faa/claude-ai?text=${encodeURIComponent(prompt)}`;
  return await fetchAI(url, 'Claude');
}

async function callBlackbox(prompt) {
  const url = `https://api-faa.my.id/faa/blackbox?query=${encodeURIComponent(prompt)}`;
  return await fetchAI(url, 'Blackbox');
}

async function callDeepseak(prompt) {
  const url = `https://api-faa.my.id/faa/deep-ai?text=${encodeURIComponent(prompt)}`;
  return await fetchAI(url, 'Deepseak');
}

async function fetchAI(url, providerName) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30 detik per request
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${providerName} HTTP ${res.status}`);
    const data = await res.json();
    if (!data.status || !data.result) throw new Error(`${providerName} response invalid`);
    return data.result;
  } finally {
    clearTimeout(timeout);
  }
}

/* ==================== NORMALISASI RESPONSE ==================== */

function normalizeAIResponse(raw, providerName) {
  if (!raw) throw new Error(`${providerName} empty result`);
  let cleaned = String(raw)
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`${providerName} no JSON found`);
  const jsonStr = cleaned.slice(start, end + 1);
  const parsed = JSON.parse(jsonStr);
  if (!parsed.questions || !Array.isArray(parsed.questions)) {
    throw new Error(`${providerName} questions not array`);
  }
  return parsed.questions;
}

/* ==================== VALIDASI SOAL ==================== */

function validateQuestion(q) {
  if (!q || typeof q !== 'object') return false;
  if (!q.id || !q.question) return false;
  if (q.type === 'multiple_choice') {
    if (!q.options || !q.answer) return false;
    for (const key of ['A', 'B', 'C', 'D']) {
      if (!q.options[key]) return false;
      if (!q.optionExplanations || !q.optionExplanations[key]) return false;
    }
    if (!['A', 'B', 'C', 'D'].includes(q.answer)) return false;
    return true;
  } else if (q.type === 'essay') {
    if (!q.expectedAnswer || !q.explanation) return false;
    if (!q.gradingCriteria || !Array.isArray(q.gradingCriteria) || q.gradingCriteria.length === 0) return false;
    return true;
  }
  return false;
}

/* ==================== ANTI-DUPLIKASI ==================== */

function normalizeText(str) {
  return String(str)
    .toLowerCase()
    .replace(/[?!.,;:'"`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(str) {
  return str.split(' ').filter(word => word.length > 0);
}

function jaccardSimilarity(a, b) {
  const setA = new Set(tokenize(normalizeText(a)));
  const setB = new Set(tokenize(normalizeText(b)));
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

function isDuplicate(questionText, existingQuestionTexts, threshold = 0.7) {
  const normalizedNew = normalizeText(questionText);
  if (!normalizedNew) return true;
  return existingQuestionTexts.some(existing => {
    const normalizedExisting = normalizeText(existing);
    if (normalizedNew === normalizedExisting) return true;
    if (normalizedNew.includes(normalizedExisting) || normalizedExisting.includes(normalizedNew)) return true;
    const similarity = jaccardSimilarity(normalizedNew, normalizedExisting);
    return similarity >= threshold;
  });
}

/* ==================== SHUFFLE OPTIONS (MULTIPLE CHOICE) ==================== */

function shuffleOptions(question) {
  if (question.type !== 'multiple_choice') return question;

  const items = ['A', 'B', 'C', 'D'].map(letter => ({
    text: question.options[letter],
    explanation: question.optionExplanations[letter],
    isCorrect: letter === question.answer
  }));

  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }

  const newOptions = {};
  const newExplanations = {};
  let newAnswer = null;
  const newLetters = ['A', 'B', 'C', 'D'];
  items.forEach((item, index) => {
    const newLetter = newLetters[index];
    newOptions[newLetter] = item.text;
    newExplanations[newLetter] = item.explanation;
    if (item.isCorrect) newAnswer = newLetter;
  });

  question.options = newOptions;
  question.answer = newAnswer;
  question.optionExplanations = newExplanations;
  return question;
}

function balanceAnswerDistribution(questions) {
  const mcqQuestions = questions.filter(q => q.type === 'multiple_choice');
  if (mcqQuestions.length === 0) return;
  const MAX_ATTEMPTS = 50;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const counts = { A: 0, B: 0, C: 0, D: 0 };
    mcqQuestions.forEach(q => counts[q.answer]++);
    const avg = mcqQuestions.length / 4;
    const threshold = Math.ceil(avg * 1.5);
    const dominant = Object.keys(counts).find(letter => counts[letter] > threshold);
    if (!dominant) break;
    const idx = questions.findIndex(q => q.type === 'multiple_choice' && q.answer === dominant);
    if (idx === -1) break;
    shuffleOptions(questions[idx]);
  }
}

/* ==================== PROMPT BUILDER ==================== */

function buildBatchPrompt(materi, instruksi, difficulty, count, previousQuestions) {
  const prevList = previousQuestions.length
    ? `HINDARI DUPLIKASI:\nBerikut daftar pertanyaan yang sudah pernah dibuat (jangan ulangi atau buat yang mirip):\n${previousQuestions
        .map((q, i) => `${i + 1}. ${q}`)
        .join('\n')}`
    : '';

  const mcqTarget = Math.round(count * 0.65);
  const essayTarget = count - mcqTarget;

  return `Kamu adalah AI pembuat soal quiz untuk belajar.

MATERI:
${materi}

INSTRUKSI TAMBAHAN:
${instruksi || 'Tidak ada instruksi tambahan.'}

TINGKAT KESULITAN:
${difficulty}

JUMLAH SOAL YANG HARUS DIBUAT:
- Pilihan Ganda: ${mcqTarget} soal
- Essay: ${essayTarget} soal
Total: ${count} soal.

${prevList}

ATURAN:
1. Buat tepat jumlah yang diminta.
2. Pilihan ganda: 4 opsi (A,B,C,D), satu jawaban benar.
3. Setiap opsi harus memiliki "optionExplanations" masing-masing.
4. Essay harus memiliki "expectedAnswer", "explanation", "gradingCriteria" (array minimal 2 kriteria).
5. Soal harus sesuai materi dan tingkat kesulitan.
6. Gunakan bahasa Indonesia (kecuali user meminta lain).
7. Distractor harus relevan dan menjebak.
8. Jangan menambahkan teks di luar JSON, jangan gunakan markdown code block.
9. Pastikan JSON valid.

FORMAT OUTPUT:
{
  "questions": [
    {
      "id": 1,
      "type": "multiple_choice",
      "question": "...",
      "options": {"A":"...","B":"...","C":"...","D":"..."},
      "answer": "A",
      "optionExplanations": {"A":"...","B":"...","C":"...","D":"..."}
    },
    {
      "id": 2,
      "type": "essay",
      "question": "...",
      "expectedAnswer": "...",
      "explanation": "...",
      "gradingCriteria": ["...","..."]
    }
  ]
}`;
}

/* ==================== GENERATE QUESTIONS DARI SATU PROVIDER ==================== */

async function generateQuestionsFromProvider(provider, count, materi, instruksi, difficulty, previousQuestions) {
  const prompt = buildBatchPrompt(materi, instruksi, difficulty, count, previousQuestions);
  const rawResult = await provider.call(prompt);
  const questions = normalizeAIResponse(rawResult, provider.name);
  // Filter valid dan unik (terhadap previousQuestions)
  const valid = questions.filter(q => validateQuestion(q) && !isDuplicate(q.question, previousQuestions));
  // Jika lebih dari count, ambil acak sebanyak count
  if (valid.length > count) {
    for (let i = valid.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [valid[i], valid[j]] = [valid[j], valid[i]];
    }
    return valid.slice(0, count);
  }
  return valid;
}

/* ==================== MAIN HANDLER ==================== */

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { materi, instruksi, difficulty, jumlah, previousQuestions } = req.body || {};

  if (!materi || !difficulty || !jumlah) {
    return res.status(400).json({ error: 'Materi, tingkat kesulitan, dan jumlah soal wajib diisi.' });
  }

  const requestedCount = parseInt(jumlah, 10);
  if (isNaN(requestedCount) || requestedCount < 1) {
    return res.status(400).json({ error: 'Jumlah soal tidak valid.' });
  }
  if (requestedCount > 1000) {
    return res.status(400).json({ error: 'Jumlah soal terlalu besar, maksimal 1000 soal.' });
  }

  const allowedDiff = ['Mudah', 'Sedang', 'Sulit'];
  if (!allowedDiff.includes(difficulty)) {
    return res.status(400).json({ error: 'Tingkat kesulitan tidak valid.' });
  }

  const materiClean = String(materi).slice(0, 5000);
  const instruksiClean = instruksi ? String(instruksi).slice(0, 5000) : '';
  const previousQuestionsClean = Array.isArray(previousQuestions)
    ? previousQuestions.map(q => String(q)).slice(0, 500)
    : [];

  // State untuk generation
  let allQuestions = [];
  let allQuestionTexts = [...previousQuestionsClean];
  let remaining = requestedCount;
  let providerIndex = 0;
  const unhealthyProviders = new Set();

  while (remaining > 0 && providerIndex < AI_PROVIDERS.length) {
    const provider = AI_PROVIDERS[providerIndex];

    if (unhealthyProviders.has(provider.name)) {
      providerIndex++;
      continue;
    }

    const batchSize = Math.min(BATCH_SIZE, remaining);
    let success = false;
    let retries = 0;

    while (retries <= MAX_RETRIES && !success) {
      try {
        const questions = await generateQuestionsFromProvider(
          provider,
          batchSize,
          materiClean,
          instruksiClean,
          difficulty,
          allQuestionTexts // untuk anti-duplikasi
        );

        if (questions.length > 0) {
          // Tambahkan ke hasil
          for (const q of questions) {
            q.id = allQuestions.length + 1;
            allQuestions.push(q);
            allQuestionTexts.push(q.question);
          }
          remaining -= questions.length;
          success = true;
          // Jika provider menghasilkan kurang dari batchSize, kita lanjutkan dengan sisa
          // Tapi tetap dianggap sukses, dan akan meminta sisa lagi nanti
        } else {
          throw new Error('Provider returned 0 valid questions');
        }
      } catch (error) {
        console.error(`Provider ${provider.name} batch failed (attempt ${retries+1}):`, error.message);
        retries++;
        if (retries > MAX_RETRIES) {
          unhealthyProviders.add(provider.name);
          break;
        }
      }
    }

    // Jika provider gagal setelah retry, kita pindah ke provider berikutnya
    if (!success) {
      unhealthyProviders.add(provider.name);
      providerIndex++;
    }
    // Jika sukses, tetap di provider yang sama untuk batch berikutnya
    // Loop akan berlanjut dengan provider yang sama (kecuali remaining sudah 0)
  }

  // Jika setelah semua provider masih ada sisa, berarti gagal total
  if (allQuestions.length !== requestedCount) {
    console.error(`Failed to generate all questions. Got ${allQuestions.length}, expected ${requestedCount}`);
    return res.status(500).json({ error: 'Gagal membuat quiz. Silakan coba lagi.' });
  }

  // Post-processing: shuffle options dan balance distribusi jawaban
  const finalQuestions = allQuestions.map(q => shuffleOptions(q));
  balanceAnswerDistribution(finalQuestions);

  // Acak urutan soal
  for (let i = finalQuestions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [finalQuestions[i], finalQuestions[j]] = [finalQuestions[j], finalQuestions[i]];
  }
  finalQuestions.forEach((q, idx) => (q.id = idx + 1));

  return res.status(200).json({ questions: finalQuestions });
};
