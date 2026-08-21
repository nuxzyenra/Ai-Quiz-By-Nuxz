// script.js

// ---------- State ----------
let currentQuiz = null;          // { topic, difficulty, total, questions }
let currentIndex = 0;
let userAnswers = [];            // array objek jawaban per soal
let phase = 'form';              // 'form' | 'loading' | 'quiz' | 'result' | 'review'
let loadingInterval = null;
let loadingProgress = 0;

// ---------- DOM Elements ----------
const formContainer = document.getElementById('form-container');
const loadingContainer = document.getElementById('loading-container');
const quizContainer = document.getElementById('quiz-container');
const resultContainer = document.getElementById('result-container');
const reviewContainer = document.getElementById('review-container');

const quizForm = document.getElementById('quiz-form');
const topicInput = document.getElementById('topic');
const instructionInput = document.getElementById('instruction');
const countInput = document.getElementById('count');
const difficultyInput = document.getElementById('difficulty');

const loadingTitle = document.getElementById('loading-title');
const loadingStatus = document.getElementById('loading-status');
const progressFill = document.getElementById('progress-fill');

const questionProgress = document.getElementById('question-progress');
const questionTypeBadge = document.getElementById('question-type');
const questionDifficultyBadge = document.getElementById('question-difficulty');
const quizProgressFill = document.getElementById('quiz-progress-fill');
const questionCard = document.getElementById('question-card');
const answerFeedback = document.getElementById('answer-feedback');
const nextBtn = document.getElementById('next-btn');

const finalScore = document.getElementById('final-score');
const resultSummary = document.getElementById('result-summary');
const reviewBtn = document.getElementById('review-btn');
const newQuizBtn = document.getElementById('new-quiz-btn');
const newQuizBtn2 = document.getElementById('new-quiz-btn-2');
const backToResultBtn = document.getElementById('back-to-result-btn');
const reviewList = document.getElementById('review-list');

// ---------- Utility Functions ----------
function showContainer(container) {
  document.querySelectorAll('.container').forEach(c => c.classList.remove('active'));
  container.classList.add('active');
}

function resetState() {
  currentQuiz = null;
  currentIndex = 0;
  userAnswers = [];
  phase = 'form';
  clearLoading();
  showContainer(formContainer);
  quizForm.reset();
  countInput.value = '10';
  difficultyInput.value = 'Sedang';
}

function clearLoading() {
  if (loadingInterval) {
    clearInterval(loadingInterval);
    loadingInterval = null;
  }
  loadingProgress = 0;
  progressFill.style.width = '0%';
}

// ---------- Loading Simulation ----------
function startLoading() {
  const messages = [
    'Mempersiapkan quiz...',
    'AI sedang menyusun soal...',
    'Membuat soal...',
    'Memproses batch...',
    'AI utama mungkin mengalami kendala...',
    'Mencoba AI alternatif...',
  ];
  let msgIndex = 0;

  loadingTitle.textContent = messages[0];
  loadingStatus.textContent = messages[1];

  loadingProgress = 5;
  progressFill.style.width = loadingProgress + '%';

  loadingInterval = setInterval(() => {
    msgIndex = (msgIndex + 1) % messages.length;
    loadingTitle.textContent = messages[msgIndex];
    loadingStatus.textContent = 'Mohon tunggu sebentar...';

    loadingProgress += Math.random() * 10;
    if (loadingProgress > 90) loadingProgress = 90;
    progressFill.style.width = loadingProgress + '%';
  }, 2500);
}

function finishLoading() {
  clearLoading();
  progressFill.style.width = '100%';
}

// ---------- API Calls ----------
async function fetchQuiz(formData) {
  const response = await fetch('/api/generate-quiz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formData),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Gagal membuat quiz');
  }
  return data.quiz;
}

async function fetchEvaluation(question, userAnswer) {
  const response = await fetch('/api/evaluate-answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, userAnswer }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Gagal mengevaluasi jawaban');
  }
  return data.evaluation;
}

// ---------- Quiz Rendering ----------
function displayQuestion(index) {
  if (!currentQuiz) return;

  const question = currentQuiz.questions[index];
  if (!question) return;

  currentIndex = index;
  answerFeedback.innerHTML = '';
  nextBtn.style.display = 'none';

  // Update header
  questionProgress.textContent = `Soal ${index + 1} dari ${currentQuiz.total}`;
  questionTypeBadge.textContent = question.type === 'multiple_choice' ? 'Pilihan Ganda' : 'Esai';
  questionDifficultyBadge.textContent = currentQuiz.difficulty;

  // Progress bar
  const progress = ((index) / currentQuiz.total) * 100;
  quizProgressFill.style.width = progress + '%';

  // Render question card
  if (question.type === 'multiple_choice') {
    renderMultipleChoice(question, index);
  } else {
    renderEssay(question, index);
  }
}

function renderMultipleChoice(question, index) {
  const optionsHtml = question.options.map((opt, i) => {
    const label = String.fromCharCode(65 + i); // A, B, C, D
    return `
      <button class="option-btn" data-option-index="${i}" data-label="${label}">
        <span class="option-label">${label}.</span> ${escapeHtml(opt.text)}
      </button>
    `;
  }).join('');

  questionCard.innerHTML = `
    <div class="question-text">${escapeHtml(question.question)}</div>
    <div class="options-list">
      ${optionsHtml}
    </div>
  `;

  // Attach event listeners
  document.querySelectorAll('.option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (userAnswers[index]) return; // sudah dijawab
      const selectedIndex = parseInt(btn.dataset.optionIndex);
      handleMultipleChoiceAnswer(question, selectedIndex);
    });
  });
}

function handleMultipleChoiceAnswer(question, selectedIndex) {
  const correctIndex = question.correctAnswer;
  const isCorrect = selectedIndex === correctIndex;
  const selectedText = question.options[selectedIndex].text;
  const correctText = question.options[correctIndex].text;

  // Simpan jawaban
  userAnswers[currentIndex] = {
    type: 'multiple_choice',
    selectedIndex,
    selectedText,
    correctIndex,
    correctText,
    isCorrect,
    score: isCorrect ? 100 : 0,
    explanation: question.explanation,
    optionExplanations: question.options,
  };

  // Tampilkan feedback
  let feedbackHtml = '';
  if (isCorrect) {
    feedbackHtml = `
      <div class="feedback-card success">
        <h4>✅ Benar!</h4>
        <p class="feedback-detail">Jawaban kamu: <strong>${escapeHtml(selectedText)}</strong></p>
        <p class="feedback-detail">Alasan benar: ${escapeHtml(question.options[selectedIndex].explanation)}</p>
        <p class="feedback-detail">Pembahasan: ${escapeHtml(question.explanation)}</p>
      </div>
    `;
  } else {
    feedbackHtml = `
      <div class="feedback-card error">
        <h4>❌ Salah!</h4>
        <p class="feedback-detail">Jawaban kamu: <strong>${escapeHtml(selectedText)}</strong></p>
        <p class="feedback-detail">Jawaban benar: <strong>${escapeHtml(correctText)}</strong></p>
        <p class="feedback-detail">Alasan jawaban kamu salah: ${escapeHtml(question.options[selectedIndex].explanation)}</p>
        <p class="feedback-detail">Alasan jawaban benar: ${escapeHtml(question.options[correctIndex].explanation)}</p>
        <p class="feedback-detail">Pembahasan: ${escapeHtml(question.explanation)}</p>
      </div>
    `;
  }
  answerFeedback.innerHTML = feedbackHtml;

  // Tandai tombol
  document.querySelectorAll('.option-btn').forEach(btn => {
    const idx = parseInt(btn.dataset.optionIndex);
    btn.classList.add('disabled');
    if (idx === correctIndex) {
      btn.classList.add('correct-answer');
    }
    if (idx === selectedIndex) {
      btn.classList.add(isCorrect ? 'selected-correct' : 'selected-wrong');
    }
  });

  // Tampilkan tombol next
  showNextButton();
}

function renderEssay(question, index) {
  questionCard.innerHTML = `
    <div class="question-text">${escapeHtml(question.question)}</div>
    <textarea class="essay-textarea" id="essay-answer" placeholder="Tulis jawaban kamu di sini..."></textarea>
    <button id="check-essay-btn" class="btn btn-secondary btn-block">Periksa Jawaban</button>
  `;

  const textarea = document.getElementById('essay-answer');
  const checkBtn = document.getElementById('check-essay-btn');

  checkBtn.addEventListener('click', async () => {
    if (userAnswers[index]) return;
    const userText = textarea.value.trim();
    if (!userText) {
      alert('Jawaban tidak boleh kosong');
      return;
    }

    checkBtn.disabled = true;
    checkBtn.textContent = 'Sedang memeriksa...';

    try {
      const evaluation = await fetchEvaluation(question.question, userText);
      handleEssayAnswer(question, userText, evaluation);
    } catch (error) {
      alert(error.message || 'Gagal mengevaluasi jawaban');
      checkBtn.disabled = false;
      checkBtn.textContent = 'Periksa Jawaban';
    }
  });
}

function handleEssayAnswer(question, userText, evaluation) {
  userAnswers[currentIndex] = {
    type: 'essay',
    userText,
    score: evaluation.score,
    isCorrect: evaluation.isCorrect,
    feedback: evaluation.feedback,
    idealAnswer: evaluation.idealAnswer,
    missingPoints: evaluation.missingPoints,
    explanation: question.explanation,
  };

  const statusClass = evaluation.isCorrect ? 'success' : 'error';
  const statusIcon = evaluation.isCorrect ? '✅' : '❌';
  const missingPointsHtml = evaluation.missingPoints.length
    ? `<p class="feedback-detail"><strong>Poin yang kurang:</strong> ${evaluation.missingPoints.map(p => escapeHtml(p)).join(', ')}</p>`
    : '';

  answerFeedback.innerHTML = `
    <div class="feedback-card ${statusClass}">
      <h4>${statusIcon} Nilai: ${evaluation.score}/100</h4>
      <p class="feedback-detail"><strong>Feedback:</strong> ${escapeHtml(evaluation.feedback)}</p>
      <p class="feedback-detail"><strong>Jawaban ideal:</strong> ${escapeHtml(evaluation.idealAnswer)}</p>
      ${missingPointsHtml}
      <p class="feedback-detail"><strong>Pembahasan:</strong> ${escapeHtml(question.explanation)}</p>
    </div>
  `;

  // Disable textarea dan tombol
  const textarea = document.getElementById('essay-answer');
  const checkBtn = document.getElementById('check-essay-btn');
  if (textarea) textarea.disabled = true;
  if (checkBtn) checkBtn.style.display = 'none';

  showNextButton();
}

function showNextButton() {
  nextBtn.style.display = 'block';
  nextBtn.textContent = currentIndex + 1 >= currentQuiz.total ? 'Lihat Hasil' : 'Soal Berikutnya';
}

// ---------- Navigation ----------
nextBtn.addEventListener('click', () => {
  if (currentIndex + 1 < currentQuiz.total) {
    displayQuestion(currentIndex + 1);
  } else {
    showResult();
  }
});

// ---------- Result ----------
function showResult() {
  showContainer(resultContainer);
  const total = currentQuiz.total;
  const correctCount = userAnswers.filter(ans => ans.isCorrect).length;
  const wrongCount = total - correctCount;
  const averageScore = Math.round(
    userAnswers.reduce((sum, ans) => sum + ans.score, 0) / total
  );

  finalScore.textContent = `${averageScore} / 100`;
  resultSummary.innerHTML = `
    <div class="summary-item">
      <div class="number">${correctCount}</div>
      <div class="label">Benar</div>
    </div>
    <div class="summary-item">
      <div class="number">${wrongCount}</div>
      <div class="label">Salah</div>
    </div>
    <div class="summary-item">
      <div class="number">${total}</div>
      <div class="label">Total</div>
    </div>
  `;
}

// ---------- Review ----------
function showReview() {
  showContainer(reviewContainer);
  reviewList.innerHTML = '';

  currentQuiz.questions.forEach((question, index) => {
    const answer = userAnswers[index];
    let answerHtml = '';

    if (question.type === 'multiple_choice') {
      answerHtml = `
        <p class="answer">Jawaban kamu: <strong>${escapeHtml(answer.selectedText)}</strong></p>
        <p class="answer">Jawaban benar: <strong>${escapeHtml(answer.correctText)}</strong></p>
        <p class="answer status ${answer.isCorrect ? 'status-correct' : 'status-wrong'}">${answer.isCorrect ? '✅ Benar' : '❌ Salah'}</p>
        <p class="answer"><strong>Pembahasan:</strong> ${escapeHtml(question.explanation)}</p>
      `;
    } else {
      answerHtml = `
        <p class="answer">Jawaban kamu: <strong>${escapeHtml(answer.userText)}</strong></p>
        <p class="answer">Nilai: <strong>${answer.score}/100</strong></p>
        <p class="answer">Feedback: ${escapeHtml(answer.feedback)}</p>
        <p class="answer">Jawaban ideal: ${escapeHtml(answer.idealAnswer)}</p>
        <p class="answer">Poin kurang: ${answer.missingPoints.map(p => escapeHtml(p)).join(', ') || 'Tidak ada'}</p>
        <p class="answer status ${answer.isCorrect ? 'status-correct' : 'status-wrong'}">${answer.isCorrect ? '✅ Benar' : '❌ Salah'}</p>
      `;
    }

    const item = document.createElement('div');
    item.className = 'review-item';
    item.innerHTML = `
      <p class="question">${index + 1}. ${escapeHtml(question.question)}</p>
      ${answerHtml}
    `;
    reviewList.appendChild(item);
  });
}

// ---------- Event Listeners ----------
quizForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const topic = topicInput.value.trim();
  const instruction = instructionInput.value.trim();
  const count = parseInt(countInput.value, 10);
  const difficulty = difficultyInput.value;

  if (!topic) {
    alert('Materi wajib diisi');
    return;
  }
  if (!Number.isInteger(count) || count <= 0) {
    alert('Jumlah soal harus angka positif');
    return;
  }

  // Reset state untuk quiz baru
  currentQuiz = null;
  currentIndex = 0;
  userAnswers = [];

  // Tampilkan loading
  showContainer(loadingContainer);
  startLoading();

  try {
    const quiz = await fetchQuiz({ topic, instruction, count, difficulty });
    currentQuiz = quiz;
    finishLoading();
    showContainer(quizContainer);
    displayQuestion(0);
  } catch (error) {
    finishLoading();
    alert(error.message || 'Terjadi kesalahan. Silakan coba lagi.');
    showContainer(formContainer);
  }
});

reviewBtn.addEventListener('click', showReview);
backToResultBtn.addEventListener('click', showResult);
newQuizBtn.addEventListener('click', resetState);
newQuizBtn2.addEventListener('click', resetState);

// ---------- Helper Escape HTML ----------
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---------- Initial state ----------
resetState();