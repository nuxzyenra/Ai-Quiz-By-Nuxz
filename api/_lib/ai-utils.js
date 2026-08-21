// api/_lib/ai-utils.js

/**
 * Konfigurasi penyedia AI terpusat.
 * Urutan array menentukan prioritas fallback.
 */
const AI_PROVIDERS = [
  { name: "Gemini", url: "https://api-faa.my.id/faa/gemini-ai?text=" },
  { name: "Claude", url: "https://api-faa.my.id/faa/claude-ai?text=" },
  { name: "Blackbox", url: "https://api-faa.my.id/faa/blackbox?query=" },
  { name: "Deepseak", url: "https://api-faa.my.id/faa/deep-ai?text=" },
];

const REQUEST_TIMEOUT = 12000; // 12 detik per provider agar tetap aman di Serverless Function
const MAX_RETRIES = 0; // satu percobaan per provider, lalu langsung fallback ke provider berikutnya
const BATCH_SIZE = 10; // jumlah soal per batch

/**
 * Memanggil provider AI dengan timeout.
 * Mengembalikan teks hasil ekstraksi dari respons.
 */
async function callAIProvider(provider, prompt) {
  const url = provider.url + encodeURIComponent(prompt);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const raw = await response.text();
    if (!raw || !raw.trim()) {
      throw new Error('Respons kosong');
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      data = raw;
    }

    const text = extractAIText(data);
    if (!text) {
      throw new Error('Respons kosong atau format tidak dikenali');
    }
    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Mengekstrak teks dari berbagai kemungkinan struktur respons API.
 */
function extractAIText(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;

  // Cek field-field yang umum
  const candidates = [
    data.text,
    data.response,
    data.result,
    data.output,
    data.answer,
    data.message,
    data.content,
    data.generated_text,
    data.choices?.[0]?.text,
    data.choices?.[0]?.message?.content,
    data.candidates?.[0]?.output,
    data.candidates?.[0]?.content?.parts?.[0]?.text,
    data.data,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
    if (candidate && typeof candidate === 'object') {
      const nested = extractAIText(candidate);
      if (nested) return nested;
    }
  }

  // Fallback terakhir: coba stringify seluruh data
  try {
    const str = JSON.stringify(data);
    if (str && str.trim() && str.trim() !== '{}' && str.trim() !== '[]') {
      return str;
    }
  } catch (e) {
    // abaikan
  }

  return '';
}

/**
 * Mencoba parsing JSON dari teks, termasuk jika ada markdown atau teks tambahan.
 */
function parseAIJSON(text) {
  if (!text) return null;

  // Coba parse langsung
  try {
    return JSON.parse(text);
  } catch (e) {
    // lanjut
  }

  // Cari blok kode JSON
  const jsonBlockRegex = /```json\s*([\s\S]*?)```/;
  const blockMatch = text.match(jsonBlockRegex);
  if (blockMatch) {
    try {
      return JSON.parse(blockMatch[1]);
    } catch (e2) {
      // lanjut
    }
  }

  // Cari kurung kurawal pertama dan terakhir
  const startCurly = text.indexOf('{');
  const endCurly = text.lastIndexOf('}');
  if (startCurly !== -1 && endCurly !== -1 && endCurly > startCurly) {
    try {
      return JSON.parse(text.substring(startCurly, endCurly + 1));
    } catch (e3) {
      // lanjut
    }
  }

  // Cari kurung siku pertama dan terakhir
  const startSquare = text.indexOf('[');
  const endSquare = text.lastIndexOf(']');
  if (startSquare !== -1 && endSquare !== -1 && endSquare > startSquare) {
    try {
      return JSON.parse(text.substring(startSquare, endSquare + 1));
    } catch (e4) {
      // lanjut
    }
  }

  return null;
}

/**
 * Validasi batch soal sesuai aturan.
 */
function validateQuizBatch(data, expectedCount) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.questions)) return false;
  if (data.questions.length !== expectedCount) return false;

  for (const q of data.questions) {
    if (!q || typeof q !== 'object') return false;
    if (!q.question || typeof q.question !== 'string' || q.question.trim() === '') return false;

    if (q.type === 'multiple_choice') {
      if (!Array.isArray(q.options) || q.options.length !== 4) return false;
      if (typeof q.correctAnswer !== 'number' || q.correctAnswer < 0 || q.correctAnswer > 3) return false;
      for (const opt of q.options) {
        if (!opt || typeof opt.text !== 'string' || opt.text.trim() === '') return false;
        if (!opt.explanation || typeof opt.explanation !== 'string') return false;
      }
      if (!q.explanation || typeof q.explanation !== 'string') return false;
    } else if (q.type === 'essay') {
      if (!q.idealAnswer || typeof q.idealAnswer !== 'string') return false;
      if (!q.explanation || typeof q.explanation !== 'string') return false;
    } else {
      return false;
    }
  }

  return true;
}

/**
 * Mengacak pilihan ganda dengan Fisher-Yates Shuffle.
 * Memperbarui correctAnswer setelah shuffle.
 */
function shuffleOptions(question) {
  if (question.type !== 'multiple_choice' || !Array.isArray(question.options)) {
    return question;
  }

  const correctIndex = question.correctAnswer;
  if (correctIndex < 0 || correctIndex >= question.options.length) {
    return question;
  }

  // Simpan teks jawaban benar agar tidak kehilangan referensi
  const correctText = question.options[correctIndex].text;

  // Salin array dan acak
  const shuffled = [...question.options];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Cari index baru dari jawaban benar
  const newIndex = shuffled.findIndex(opt => opt.text === correctText);
  if (newIndex === -1) {
    // Jika gagal (seharusnya tidak), kembalikan tanpa perubahan
    return question;
  }

  question.options = shuffled;
  question.correctAnswer = newIndex;
  return question;
}

module.exports = {
  AI_PROVIDERS,
  REQUEST_TIMEOUT,
  MAX_RETRIES,
  BATCH_SIZE,
  callAIProvider,
  extractAIText,
  parseAIJSON,
  validateQuizBatch,
  shuffleOptions,
};