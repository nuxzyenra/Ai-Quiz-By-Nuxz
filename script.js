// ==================== STATE ====================
let state = {
  settings: null,
  quiz: null,
  currentIndex: 0,
  answers: [],
  selectedOption: null,
  previousQuestions: []
};

// ==================== DOM ELEMENTS ====================
const views = {
  home: document.getElementById('home-view'),
  loading: document.getElementById('loading-view'),
  quiz: document.getElementById('quiz-view'),
  result: document.getElementById('result-view')
};

const errorBanner = document.getElementById('error-banner');
const btnMulai = document.getElementById('btn-mulai');
const btnJawab = document.getElementById('btn-jawab');
const btnRetry = document.getElementById('btn-retry');
const btnBackSettings = document.getElementById('btn-back-settings');
const btnHapusRiwayat = document.getElementById('btn-hapus-riwayat');

// ==================== UTILS ====================
function showView(viewName) {
  Object.keys(views).forEach(key => {
    views[key].classList.toggle('hidden', key !== viewName);
  });
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.remove('hidden');
}

function hideError() {
  errorBanner.textContent = '';
  errorBanner.classList.add('hidden');
}

// ==================== GENERATE QUIZ ====================
async function generateQuiz(settings, previousQuestions = []) {
  const res = await fetch('/api/generate-quiz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...settings, previousQuestions })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Gagal membuat quiz. Silakan coba lagi.');
  }
  return data;
}

// ==================== START QUIZ ====================
btnMulai.addEventListener('click', async () => {
  hideError();

  const materi = document.getElementById('materi').value.trim();
  const instruksi = document.getElementById('instruksi').value.trim();
  const jumlah = document.getElementById('jumlah').value;
  const difficulty = document.getElementById('difficulty').value;

  if (!materi) {
    showError('Silakan masukkan materi atau topik terlebih dahulu.');
    return;
  }

  state.settings = { materi, instruksi, jumlah, difficulty };
  state.previousQuestions = [];
  await startQuizGeneration();
});

async function startQuizGeneration() {
  showView('loading');
  btnMulai.disabled = true;

  try {
    const data = await generateQuiz(state.settings, state.previousQuestions);
    state.quiz = data.questions;
    state.currentIndex = 0;
    state.answers = new Array(state.quiz.length).fill(null);
    state.previousQuestions = state.quiz.map(q => q.question);
    renderQuiz();
    showView('quiz');
  } catch (error) {
    console.error(error);
    showView('home');
    showError('Gagal membuat quiz. Silakan coba lagi.');
  } finally {
    btnMulai.disabled = false;
  }
}

// ==================== RENDER QUIZ ====================
function renderQuiz() {
  const question = state.quiz[state.currentIndex];
  state.selectedOption = null;

  // Quiz info
  document.getElementById('quiz-materi').textContent = state.settings.materi;
  document.getElementById('quiz-difficulty').textContent = state.settings.difficulty;

  // Progress
  const progress = ((state.currentIndex) / state.quiz.length) * 100;
  document.getElementById('progress-fill').style.width = `${progress}%`;
  document.getElementById('question-number').textContent =
    `Soal ${state.currentIndex + 1} dari ${state.quiz.length}`;

  // Question
  document.getElementById('question-text').textContent = question.question;

  // Options
  const optionsContainer = document.getElementById('options-container');
  optionsContainer.innerHTML = '';

  ['A', 'B', 'C', 'D'].forEach(key => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.innerHTML = `<span class="option-letter">${key}.</span> ${escapeHTML(question.options[key])}`;
    btn.addEventListener('click', () => selectOption(key, btn));
    optionsContainer.appendChild(btn);
  });

  // Jawab button
  btnJawab.disabled = true;
  btnJawab.textContent = state.currentIndex === state.quiz.length - 1 ? 'Lihat Hasil' : 'Jawab';
}

function selectOption(key, btnElement) {
  // Remove selected class from all options
  document.querySelectorAll('.option-btn').forEach(btn => btn.classList.remove('selected'));
  btnElement.classList.add('selected');
  state.selectedOption = key;
  btnJawab.disabled = false;
}

// Helper escape HTML (prevent XSS)
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ==================== SUBMIT ANSWER ====================
btnJawab.addEventListener('click', () => {
  if (!state.selectedOption) return;

  // Save answer
  state.answers[state.currentIndex] = state.selectedOption;

  if (state.currentIndex < state.quiz.length - 1) {
    state.currentIndex++;
    renderQuiz();
  } else {
    showResults();
  }
});

// ==================== RESULTS ====================
function showResults() {
  let correct = 0;
  state.answers.forEach((ans, idx) => {
    if (ans === state.quiz[idx].answer) correct++;
  });

  const wrong = state.quiz.length - correct;
  const score = Math.round((correct / state.quiz.length) * 100);

  // Update UI
  document.getElementById('score-value').textContent = score;
  document.getElementById('correct-count').textContent = correct;
  document.getElementById('wrong-count').textContent = wrong;

  let message = '';
  if (score >= 80) message = 'Pertahankan! 🎉';
  else if (score >= 60) message = 'Cukup baik, terus belajar!';
  else message = 'Jangan menyerah, pelajari lagi materinya.';
  document.getElementById('score-message').textContent = message;

  // Render pembahasan
  renderPembahasan();

  // Save history
  saveHistory(correct, wrong, score);

  showView('result');
}

function renderPembahasan() {
  const container = document.getElementById('pembahasan-container');
  container.innerHTML = '';

  state.quiz.forEach((question, index) => {
    const userAnswer = state.answers[index];
    const isCorrect = userAnswer === question.answer;

    const card = document.createElement('div');
    card.className = `pembahasan-card ${isCorrect ? 'benar' : 'salah'}`;

    const statusClass = isCorrect ? 'benar-text' : 'salah-text';
    const statusText = isCorrect ? 'Benar' : 'Salah';

    const optionsHTML = ['A', 'B', 'C', 'D'].map(key => {
      const optionText = question.options[key];
      const isUserChoice = key === userAnswer;
      const isCorrectChoice = key === question.answer;
      let label = `${key}. ${escapeHTML(optionText)}`;
      if (isUserChoice && isCorrectChoice) label += ' ✅';
      else if (isUserChoice) label += ' ❌';
      else if (isCorrectChoice) label += ' ✅ (Jawaban benar)';
      return `<div class="${isUserChoice ? 'user-answer' : ''} ${isCorrectChoice ? 'correct-answer' : ''}">${label}</div>`;
    }).join('');

    card.innerHTML = `
      <h3>Soal ${index + 1}</h3>
      <p>${escapeHTML(question.question)}</p>
      <div class="options-container" style="margin-top:12px;">
        ${optionsHTML}
      </div>
      <div class="status ${statusClass}">${statusText}</div>
      <div class="explanation"><strong>Pembahasan:</strong> ${escapeHTML(question.explanation)}</div>
    `;

    container.appendChild(card);
  });
}

// ==================== HISTORY ====================
function getHistory() {
  try {
    return JSON.parse(localStorage.getItem('quizHistory')) || [];
  } catch {
    return [];
  }
}

function saveHistory(correct, wrong, score) {
  const history = getHistory();
  const materi = state.settings.materi;
  const sameMateriCount = history.filter(item => item.materi === materi).length;
  const entry = {
    materi,
    percobaan: sameMateriCount + 1,
    jumlahSoal: state.quiz.length,
    benar: correct,
    salah: wrong,
    nilai: score,
    waktu: new Date().toLocaleString('id-ID')
  };
  history.push(entry);
  localStorage.setItem('quizHistory', JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  const list = document.getElementById('history-list');
  const history = getHistory();
  if (history.length === 0) {
    list.innerHTML = '<p class="empty-text">Belum ada riwayat.</p>';
    return;
  }

  list.innerHTML = '';
  history.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <div class="history-info">
        <div class="history-title">${escapeHTML(item.materi)}</div>
        <div class="history-meta">
          Percobaan ${item.percobaan} • ${item.jumlahSoal} soal • ${item.waktu}
        </div>
      </div>
      <div class="history-score">${item.nilai} / 100</div>
    `;
    list.appendChild(div);
  });
}

btnHapusRiwayat.addEventListener('click', () => {
  if (confirm('Apakah Anda yakin ingin menghapus semua riwayat quiz?')) {
    localStorage.removeItem('quizHistory');
    renderHistory();
  }
});

// ==================== RETRY / BACK ====================
btnRetry.addEventListener('click', async () => {
  showView('loading');
  try {
    // Use same settings, but send previous questions to avoid duplicates
    const data = await generateQuiz(state.settings, state.previousQuestions);
    state.quiz = data.questions;
    state.currentIndex = 0;
    state.answers = new Array(state.quiz.length).fill(null);
    state.previousQuestions = state.quiz.map(q => q.question);
    renderQuiz();
    showView('quiz');
  } catch (error) {
    console.error(error);
    showView('home');
    showError('Gagal membuat quiz. Silakan coba lagi.');
  }
});

btnBackSettings.addEventListener('click', () => {
  showView('home');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  renderHistory();
  showView('home');
});