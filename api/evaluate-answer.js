// api/evaluate-answer.js
// Vercel Serverless Function
// Endpoint: /api/evaluate-answer

const AI_PROVIDERS = [
  { name: 'gemini', call: callGemini },
  { name: 'claude', call: callClaude },
  { name: 'blackbox', call: callBlackbox },
  { name: 'deepseak', call: callDeepseak }
];

const MAX_RETRIES = 1;

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
  const timeout = setTimeout(() => controller.abort(), 30000);
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

function normalizeAIResponse(raw, providerName) {
  if (!raw) throw new Error(`${providerName} empty result`);
  let cleaned = String(raw).replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`${providerName} no JSON found`);
  const jsonStr = cleaned.slice(start, end + 1);
  return JSON.parse(jsonStr);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { question, expectedAnswer, gradingCriteria, userAnswer } = req.body || {};
  if (!question || !expectedAnswer || !gradingCriteria || !userAnswer) {
    return res.status(400).json({ error: 'Data tidak lengkap untuk evaluasi.' });
  }

  const prompt = `Kamu adalah AI penilai jawaban essay untuk quiz belajar.

SOAL:
${question}

JAWABAN IDEAL:
${expectedAnswer}

KRITERIA PENILAIAN:
${gradingCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

JAWABAN USER:
${userAnswer}

Tugas kamu menilai jawaban user berdasarkan kriteria dan jawaban ideal.
Output JSON dengan format:
{
  "score": 0,
  "isCorrect": false,
  "feedback": "...",
  "missingPoints": ["..."],
  "idealAnswer": "..."
}
Aturan:
- score 0-100
- isCorrect true jika score >= 60
- Jangan menambahkan teks di luar JSON.
- Jangan gunakan markdown code block.`;

  // Coba provider secara berurutan, dengan retry terbatas
  for (const provider of AI_PROVIDERS) {
    let retries = 0;
    while (retries <= MAX_RETRIES) {
      try {
        const rawResult = await provider.call(prompt);
        const parsed = normalizeAIResponse(rawResult, provider.name);
        if (
          typeof parsed.score !== 'number' ||
          typeof parsed.isCorrect !== 'boolean' ||
          typeof parsed.feedback !== 'string' ||
          !Array.isArray(parsed.missingPoints) ||
          typeof parsed.idealAnswer !== 'string'
        ) {
          throw new Error('Format evaluasi tidak valid');
        }
        return res.status(200).json(parsed);
      } catch (error) {
        console.error(`Evaluasi dengan ${provider.name} attempt ${retries+1} gagal:`, error.message);
        retries++;
      }
    }
    // Jika retries habis, lanjut ke provider berikutnya
  }

  return res.status(500).json({ error: 'Gagal memeriksa jawaban. Silakan coba lagi.' });
};
