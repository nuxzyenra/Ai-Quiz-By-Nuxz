// api/generate-quiz.js
// Vercel Serverless Function
// Endpoint: /api/generate-quiz

const AI_PROVIDERS = [
  { name: 'gemini', call: callGemini },
  { name: 'claude', call: callClaude },
  { name: 'blackbox', call: callBlackbox },
  { name: 'deepseak', call: callDeepseak }
];

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
  const timeout = setTimeout(() => controller.abort(), 30000); // 30 detik per provider
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
    .replace(/[?!.,;:'"`]/g, '')   // hapus tanda baca
    .replace(/\s+/g, ' ')          // spasi berlebih
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
    // Cek substring
    if (normalizedNew.includes(normalizedExisting) || normalizedExisting.includes(normalizedNew)) return true;
    // Cek similarity
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

  // Fisher-Yates shuffle
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
    if (item.isCorrect) {
      newAnswer = newLetter;
    }
  });

  question.options = newOptions;
  question.answer = newAnswer;
  question.optionExplanations = newExplanations;

  return question;
}

/* ==================== BALANCING A/B/C/D ==================== */

function balanceAnswerDistribution(questions) {
  const mcqQuestions = questions.filter(q => q.type === 'multiple_choice');
  if (mcqQuestions.length === 0) return;

  const MAX_ATTEMPTS = 50; // batas aman
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const counts = { A: 0, B: 0, C: 0, D: 0 };
    mcqQuestions.forEach(q => counts[q.answer]++);
    const avg = mcqQuestions.length / 4;
    const threshold = Math.ceil(avg * 1.5); // huruf tidak boleh melebihi 1.5x rata-rata

    const dominant = Object.keys(counts).find(letter => counts[letter] > threshold);
    if (!dominant) break; // sudah cukup seimbang

    // Cari satu soal dengan jawaban dominant, lalu shuffle ulang
    const idx = questions.findIndex(q => q.type === 'multiple_choice' && q.answer === dominant);
    if (idx === -1) break;
    shuffleOptions(questions[idx]);
  }
}

/* ==================== PROMPT BUILDER ==================== */

function buildBatchPrompt(materi, instruksi, difficulty, totalCount, providerName, previousQuestions) {
  const mcqTarget = Math.round(totalCount * 0.65);
  const essayTarget = totalCount - mcqTarget;

  const prevList = previousQuestions.length
    ? `HINDARI DUPLIKASI:\nBerikut daftar pertanyaan yang sudah pernah dibuat (jangan ulangi atau buat yang mirip):\n${previousQuestions
        .map((q, i) => `${i + 1}. ${q}`)
        .join('\n')}`
    : '';

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
Total: ${totalCount} soal.

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

/* ==================== GENERATE QUESTIONS FROM PROVIDER ==================== */

async function generateQuestionsFromProvider(provider, targetCount, materi, instruksi, difficulty, previousQuestions) {
  const prompt = buildBatchPrompt(materi, instruksi, difficulty, targetCount, provider.name, previousQuestions);
  const rawResult = await provider.call(prompt);
  const questions = normalizeAIResponse(rawResult, provider.name);
  // Filter valid
  let valid = questions.filter(q => validateQuestion(q));
  // Jika lebih dari target, potong
  if (valid.length > targetCount) {
    // Shuffle lalu ambil targetCount
    for (let i = valid.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [valid[i], valid[j]] = [valid[j], valid[i]];
    }
    valid = valid.slice(0, targetCount);
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

  let previousQuestionsClean = [];
  if (Array.isArray(previousQuestions)) {
    previousQuestionsClean = previousQuestions.map(q => String(q)).slice(0, 500);
  }

  const allQuestions = [];
  const allQuestionTexts = []; // untuk anti-duplikasi internal
  const workingProviders = [...AI_PROVIDERS];

  let remaining = requestedCount;
  let round = 0;
  const MAX_ROUNDS = 20; // batas putaran untuk mencegah loop tak terbatas

  while (remaining > 0 && workingProviders.length > 0 && round < MAX_ROUNDS) {
    round++;

    // Distribusi soal ke provider yang masih aktif
    const base = Math.floor(remaining / workingProviders.length);
    let remainder = remaining % workingProviders.length;
    const tasks = workingProviders.map((provider, index) => {
      const count = base + (index < remainder ? 1 : 0);
      return { provider, count };
    });

    // Jalankan semua provider secara paralel
    const taskResults = await Promise.all(
      tasks.map(async (task) => {
        if (task.count === 0) return { provider: task.provider.name, questions: [], failed: false };
        try {
          const questions = await generateQuestionsFromProvider(
            task.provider,
            task.count,
            materiClean,
            instruksiClean,
            difficulty,
            previousQuestionsClean
          );
          return { provider: task.provider.name, questions, failed: false };
        } catch (error) {
          console.error(`Provider ${task.provider.name} failed:`, error.message);
          return { provider: task.provider.name, questions: [], failed: true };
        }
      })
    );

    // Proses hasil
    const failedProviders = [];
    let roundSuccess = 0;

    for (const result of taskResults) {
      if (result.failed) {
        failedProviders.push(result.provider);
        continue;
      }
      const valid = result.questions.filter(q => validateQuestion(q));
      const unique = [];
      for (const q of valid) {
        if (!isDuplicate(q.question, allQuestionTexts) && !isDuplicate(q.question, previousQuestionsClean)) {
          unique.push(q);
        }
      }
      // Jika lebih dari jatah, potong
      const targetCountForProvider = tasks.find(t => t.provider.name === result.provider)?.count || 0;
      let selected = unique;
      if (selected.length > targetCountForProvider) {
        // Fisher-Yates shuffle lalu slice
        for (let i = selected.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [selected[i], selected[j]] = [selected[j], selected[i]];
        }
        selected = selected.slice(0, targetCountForProvider);
      }

      // Tambahkan ke allQuestions
      for (const q of selected) {
        q.id = allQuestions.length + 1;
        allQuestions.push(q);
        allQuestionTexts.push(q.question);
        previousQuestionsClean.push(q.question);
      }
      roundSuccess += selected.length;
    }

    // Update remaining dan workingProviders
    remaining = requestedCount - allQuestions.length;
    // Hapus provider yang gagal dari daftar
    for (const failedName of failedProviders) {
      const idx = workingProviders.findIndex(p => p.name === failedName);
      if (idx !== -1) workingProviders.splice(idx, 1);
    }
  }

  if (allQuestions.length !== requestedCount) {
    return res.status(500).json({ error: 'Gagal membuat quiz. Silakan coba lagi.' });
  }

  // Post-processing
  const finalQuestions = allQuestions.map(q => shuffleOptions(q));

  // Balance A/B/C/D
  balanceAnswerDistribution(finalQuestions);

  // Acak urutan soal (Fisher-Yates)
  for (let i = finalQuestions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [finalQuestions[i], finalQuestions[j]] = [finalQuestions[j], finalQuestions[i]];
  }

  // Reassign ID final
  finalQuestions.forEach((q, idx) => {
    q.id = idx + 1;
  });

  return res.status(200).json({ questions: finalQuestions });
};