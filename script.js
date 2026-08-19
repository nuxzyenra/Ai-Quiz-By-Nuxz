// ==================== STATE ====================
let state = {
  settings: null,
  quiz: [],
  currentIndex: 0,
  answers: [], // array berisi { selectedOption, essayText, score, isCorrect, feedback, ... }
  selectedOption: null,
  essayText: '',
  isAnswered: false,
  previousQuestions: [],
  history: []
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
const questionContainer = document.getElementById('question-container');
const feedbackContainer = document.getElementById('feedback-container');

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

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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
  const jumlah = parseInt(document.getElementById('jumlah').value, 10);
  const difficulty = document.getElementById('difficulty').value;

  if (!materi) {
    showError('Silakan masukkan materi atau topik terlebih dahulu.');
    return;
  }
  if (isNaN(jumlah) || jumlah < 1) {
    showError('Jumlah soal harus berupa angka minimal 1.');
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
    state.answers = new Array(state.quiz.length).fill(null).map(() => ({
      selectedOption: null,
      essayText: '',
      score: null,
      isCorrect: null,
      feedback: null,
      idealAnswer: null,
      missingPoints: []
    }));
    state.previousQuestions = state.quiz.map(q => q.question);
    state.isAnswered = false;
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
  state.essayText = '';
  state.isAnswered = false;

  // Quiz info
  document.getElementById('quiz-materi').textContent = state.settings.materi;
  document.getElementById('quiz-difficulty').textContent = state.settings.difficulty;

  // Progress
  const progress = (state.currentIndex / state.quiz.length) * 100;
  document.getElementById('progress-fill').style.width = `${progress}%`;
  document.getElementById('question-number').textContent =
    `Soal ${state.currentIndex + 1} dari ${state.quiz.length}`;

  // Clear feedback container
  feedbackContainer.innerHTML = '';
  feedbackContainer.className = 'feedback-container';
  feedbackContainer.style.display = 'none';

  // Render question based on type
  if (question.type === 'multiple_choice') {
    renderMultipleChoice(question);
  } else if (question.type === 'essay') {
    renderEssay(question);
  } else {
    // fallback
    renderMultipleChoice(question);
  }
}

function renderMultipleChoice(question) {
  let html = `<div class="question-text">${escapeHTML(question.question)}</div>`;
  html += '<div class="options-container">';
  ['A', 'B', 'C', 'D'].forEach(key => {
    const optionText = question.options[key];
    html += `
      <button class="option-btn" data-option="${key}">
        <span class="option-letter">${key}.</span> ${escapeHTML(optionText)}
      </button>
    `;
  });
  html += '</div>';
  html += `<button id="btn-jawab" class="btn-primary" disabled>Jawab</button>`;
  questionContainer.innerHTML = html;

  // Add event listeners
  const optionButtons = questionContainer.querySelectorAll('.option-btn');
  optionButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      optionButtons.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.selectedOption = btn.dataset.option;
      questionContainer.querySelector('#btn-jawab').disabled = false;
    });
  });

  questionContainer.querySelector('#btn-jawab').addEventListener('click', () => {
    if (!state.selectedOption) return;
    handleMultipleChoiceAnswer(question);
  });
}

function renderEssay(question) {
  let html = `<div class="question-text">${escapeHTML(question.question)}</div>`;
  html += `<textarea class="essay-textarea" id="essay-input" placeholder="Jawaban kamu..."></textarea>`;
  html += `<button id="btn-periksa" class="btn-primary">Periksa Jawaban</button>`;
  questionContainer.innerHTML = html;

  const textarea = questionContainer.querySelector('#essay-input');
  textarea.value = state.answers[state.currentIndex]?.essayText || '';
  textarea.addEventListener('input', () => {
    state.essayText = textarea.value;
  });

  questionContainer.querySelector('#btn-periksa').addEventListener('click', () => {
    if (!state.essayText.trim()) {
      alert('Silakan tulis jawaban kamu terlebih dahulu.');
      return;
    }
    handleEssayAnswer(question);
  });
}

// ==================== HANDLE MULTIPLE CHOICE ANSWER ====================
function handleMultipleChoiceAnswer(question) {
  const isCorrect = state.selectedOption === question.answer;
  state.answers[state.currentIndex].selectedOption = state.selectedOption;
  state.answers[state.currentIndex].isCorrect = isCorrect;
  state.answers[state.currentIndex].score = isCorrect ? 100 : 0;

  // Tampilkan feedback
  showFeedbackMCQ(question, isCorrect);
  state.isAnswered = true;
}

function showFeedbackMCQ(question, isCorrect) {
  const container = feedbackContainer;
  container.style.display = 'block';
  container.className = `feedback-container ${isCorrect ? 'benar' : 'salah'}`;

  let html = `<div class="feedback-status ${isCorrect ? 'benar-text' : 'salah-text'}">${isCorrect ? '✓ BENAR' : '✕ SALAH'}</div>`;
  if (!isCorrect) {
    html += `<div class="correct-answer">Jawaban yang benar: <strong>${escapeHTML(question.answer)}</strong></div>`;
  }
  html += `<div style="margin-top:8px;"><strong>Kenapa?</strong></div>`;
  // Loop semua opsi
  ['A', 'B', 'C', 'D'].forEach(key => {
    const explanation = question.optionExplanations?.[key] || '';
    const isCorrectOption = key === question.answer;
    const isUserChoice = key === state.selectedOption;
    let label = `${key}. ${escapeHTML(question.options[key])}`;
    if (isCorrectOption) label += ' ✅ (Benar)';
    else if (isUserChoice) label += ' ❌ (Pilihan kamu)';
    else label += ' (Salah)';
    html += `<div class="option-explanation">${label}<br><small>${escapeHTML(explanation)}</small></div>`;
  });

  html += `<button id="btn-next" class="btn-primary" style="margin-top:12px;">Soal Berikutnya</button>`;
  container.innerHTML = html;

  container.querySelector('#btn-next').addEventListener('click', () => {
    nextQuestion();
  });
}

// ==================== HANDLE ESSAY ANSWER ====================
async function handleEssayAnswer(question) {
  const btnPeriksa = questionContainer.querySelector('#btn-periksa');
  btnPeriksa.disabled = true;
  btnPeriksa.textContent = 'AI sedang memeriksa...';

  try {
    const res = await fetch('/api/evaluate-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: question.question,
        expectedAnswer: question.expectedAnswer,
        gradingCriteria: question.gradingCriteria,
        userAnswer: state.essayText
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Gagal memeriksa jawaban.');
    }

    state.answers[state.currentIndex].essayText = state.essayText;
    state.answers[state.currentIndex].score = data.score;
    state.answers[state.currentIndex].isCorrect = data.isCorrect;
    state.answers[state.currentIndex].feedback = data.feedback;
    state.answers[state.currentIndex].idealAnswer = data.idealAnswer;
    state.answers[state.currentIndex].missingPoints = data.missingPoints || [];

    showFeedbackEssay(data);
    state.isAnswered = true;
  } catch (error) {
    console.error(error);
    alert('Gagal memeriksa jawaban. Silakan coba lagi.');
  } finally {
    btnPeriksa.disabled = false;
    btnPeriksa.textContent = 'Periksa Jawaban';
  }
}

function showFeedbackEssay(evaluation) {
  const container = feedbackContainer;
  container.style.display = 'block';
  container.className = 'feedback-container';

  let html = `<div class="feedback-status">Nilai: <strong>${evaluation.score} / 100</strong></div>`;
  html += `<div><strong>Jawaban kamu:</strong><br>${escapeHTML(state.essayText)}</div>`;
  html += `<div><strong>Feedback:</strong><br>${escapeHTML(evaluation.feedback)}</div>`;
  if (evaluation.missingPoints && evaluation.missingPoints.length) {
    html += `<div><strong>Yang masih kurang:</strong><ul>`;
    evaluation.missingPoints.forEach(point => {
      html += `<li>${escapeHTML(point)}</li>`;
    });
    html += `</ul></div>`;
  }
  html += `<div><strong>Jawaban ideal:</strong><br>${escapeHTML(evaluation.idealAnswer)}</div>`;
  html += `<button id="btn-next" class="btn-primary" style="margin-top:12px;">Soal Berikutnya</button>`;
  container.innerHTML = html;

  container.querySelector('#btn-next').addEventListener('click', () => {
    nextQuestion();
  });
}

function nextQuestion() {
  if (state.currentIndex < state.quiz.length - 1) {
    state.currentIndex++;
    renderQuiz();
  } else {
    showResults();
  }
}

// ==================== RESULTS ====================
function showResults() {
  let totalScore = 0;
  let correct = 0;
  let wrong = 0;

  state.quiz.forEach((question, index) => {
    const ans = state.answers[index];
    if (question.type === 'multiple_choice') {
      if (ans.isCorrect) correct++;
      else wrong++;
      totalScore += ans.score || 0;
    } else if (question.type === 'essay') {
      if (ans.score !== null) {
        totalScore += ans.score;
        if (ans.score >= 60) correct++; // anggap benar jika >= 60? Kita bisa definisikan benar jika >= 60
        else wrong++;
      } else {
        wrong++;
      }
    }
  });

  const finalScore = Math.round(totalScore / state.quiz.length);
  document.getElementById('score-value').textContent = finalScore;
  document.getElementById('correct-count').textContent = correct;
  document.getElementById('wrong-count').textContent = wrong;

  let message = '';
  if (finalScore >= 80) message = 'Pertahankan! 🎉';
  else if (finalScore >= 60) message = 'Cukup baik, terus belajar!';
  else message = 'Jangan menyerah, pelajari lagi materinya.';
  document.getElementById('score-message').textContent = message;

  renderPembahasan();
  saveHistory(correct, wrong, finalScore);
  showView('result');
}

function renderPembahasan() {
  const container = document.getElementById('pembahasan-container');
  container.innerHTML = '';

  state.quiz.forEach((question, index) => {
    const ans = state.answers[index];
    const card = document.createElement('div');
    card.className = `pembahasan-card ${ans.isCorrect ? 'benar' : 'salah'}`;

    let html = `<h3>Soal ${index + 1}</h3>`;
    html += `<p>${escapeHTML(question.question)}</p>`;

    if (question.type === 'multiple_choice') {
      html += `<div class="status ${ans.isCorrect ? 'benar-text' : 'salah-text'}">${ans.isCorrect ? 'Benar' : 'Salah'}</div>`;
      html += `<div class="user-answer">Jawaban kamu: ${ans.selectedOption ? ans.selectedOption + '. ' + escapeHTML(question.options[ans.selectedOption]) : 'Tidak menjawab'}</div>`;
      html += `<div class="correct-answer">Jawaban benar: ${question.answer}. ${escapeHTML(question.options[question.answer])}</div>`;
      html += `<div class="explanation"><strong>Pembahasan:</strong><br>`;
      ['A', 'B', 'C', 'D'].forEach(key => {
        html += `<div class="option-explanation">${key}. ${escapeHTML(question.options[key])}<br><small>${escapeHTML(question.optionExplanations?.[key] || '')}</small></div>`;
      });
      html += `</div>`;
    } else if (question.type === 'essay') {
      html += `<div class="status ${ans.isCorrect ? 'benar-text' : 'salah-text'}">${ans.isCorrect ? 'Benar (nilai >= 60)' : 'Salah (nilai < 60)'}</div>`;
      html += `<div class="user-answer"><strong>Jawaban kamu:</strong><br>${escapeHTML(ans.essayText || 'Tidak menjawab')}</div>`;
      html += `<div class="correct-answer"><strong>Jawaban ideal:</strong><br>${escapeHTML(ans.idealAnswer || question.expectedAnswer)}</div>`;
      if (ans.feedback) {
        html += `<div class="explanation"><strong>Feedback:</strong><br>${escapeHTML(ans.feedback)}</div>`;
      }
    }

    card.innerHTML = html;
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
    mcqCount: state.quiz.filter(q => q.type === 'multiple_choice').length,
    essayCount: state.quiz.filter(q => q.type === 'essay').length,
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
          Percobaan ${item.percobaan} • ${item.jumlahSoal} soal • ${item.mcqCount} MCQ, ${item.essayCount} Essay • ${item.waktu}
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
    const data = await generateQuiz(state.settings, state.previousQuestions);
    state.quiz = data.questions;
    state.currentIndex = 0;
    state.answers = new Array(state.quiz.length).fill(null).map(() => ({
      selectedOption: null,
      essayText: '',
      score: null,
      isCorrect: null,
      feedback: null,
      idealAnswer: null,
      missingPoints: []
    }));
    state.previousQuestions = state.quiz.map(q => q.question);
    state.isAnswered = false;
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