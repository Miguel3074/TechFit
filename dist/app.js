const storageKey = "techfit-state-v1";

const defaultState = {
  name: "Miguel",
  plan: "free",
  loggedIn: false,
  sessions: [
    { name: "Reset para os punhos", minutes: 5, day: 1 },
    { name: "Destrave as costas", minutes: 6, day: 3 },
    { name: "Pescoço sem tensão", minutes: 8, day: 5 }
  ],
  preferences: { reminders: true, sounds: false }
};

const savedState = JSON.parse(localStorage.getItem(storageKey) || "null");
let state = savedState ? { ...defaultState, ...savedState, preferences: { ...defaultState.preferences, ...savedState.preferences } } : structuredClone(defaultState);
let currentWorkout = null;
let toastTimeout = null;
let timerInterval = null;
let remainingSeconds = 0;
let totalSeconds = 0;
let timerPaused = false;

const workoutLibrary = {
  "Destrave as costas": {
    icon: "⌁",
    description: "Mobilidade suave para aliviar a região lombar depois de muito tempo sentado.",
    steps: [
      "Sente-se na ponta da cadeira, apoie os pés no chão e alongue a coluna.",
      "Incline o tronco lentamente para frente e volte, mantendo o abdômen firme.",
      "Gire o tronco para cada lado sem mover o quadril e respire profundamente."
    ]
  },
  "Reset para os punhos": {
    icon: "◇",
    description: "Uma pausa para relaxar mãos, dedos e antebraços depois de usar teclado e mouse.",
    steps: [
      "Estenda um braço com a palma para cima e puxe os dedos suavemente para baixo.",
      "Faça círculos lentos com os punhos nos dois sentidos.",
      "Abra e feche as mãos devagar, alongando bem os dedos a cada repetição."
    ]
  },
  "Pescoço sem tensão": {
    icon: "◯",
    description: "Respiração e mobilidade controlada para reduzir a tensão nos ombros e na cervical.",
    steps: [
      "Sente-se com a coluna ereta e solte os ombros enquanto respira fundo.",
      "Incline a cabeça em direção a um ombro, sem levantar o ombro oposto.",
      "Olhe lentamente para a direita e para a esquerda, sem forçar o movimento."
    ]
  },
  "Fim de expediente": {
    icon: "✦",
    description: "Uma sequência completa para soltar o corpo e desacelerar ao terminar o trabalho.",
    steps: [
      "Fique em pé, eleve os braços e alongue todo o corpo enquanto inspira.",
      "Incline o tronco para cada lado e mantenha o quadril estável.",
      "Agache levemente, volte devagar e finalize soltando braços e ombros."
    ]
  }
};

const loginScreen = document.querySelector("#login-screen");
const appScreen = document.querySelector("#app-screen");
const workoutModal = document.querySelector("#workout-modal");
const toast = document.querySelector("#toast");

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function showToast(message) {
  clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.remove("hidden");
  toastTimeout = setTimeout(() => toast.classList.add("hidden"), 2600);
}

function switchView(viewName) {
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.dataset.view === viewName));
  document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.viewTarget === viewName));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateGreeting() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia," : hour < 18 ? "Boa tarde," : "Boa noite,";
  document.querySelector("#greeting").textContent = greeting;
}

function buildActivityChart() {
  const totals = Array(7).fill(0);
  state.sessions.forEach(session => totals[session.day] += session.minutes);
  const max = Math.max(...totals, 10);
  const chart = document.querySelector("#activity-chart");
  chart.innerHTML = totals.map(value => `<span class="bar ${value > 0 ? "active" : ""}" style="height:${Math.max(4, value / max * 100)}%" data-value="${value}"></span>`).join("");
  const total = totals.reduce((sum, value) => sum + value, 0);
  const count = state.sessions.length;
  document.querySelector("#week-sessions").textContent = count;
  document.querySelector("#week-minutes").textContent = `${total} min`;
  document.querySelector("#report-total").textContent = `${total} min`;
  document.querySelector("#report-sessions").textContent = count;
  document.querySelector("#report-average").textContent = `${count ? Math.round(total / count) : 0} min`;
  document.querySelector("#streak-value").textContent = Math.min(new Set(state.sessions.map(session => session.day)).size, 7);
}

function applyAccessRules() {
  const isPremium = state.plan === "premium";
  const planPill = document.querySelector("#plan-pill");
  planPill.textContent = isPremium ? "PRO" : "FREE";
  planPill.classList.toggle("premium", isPremium);
  document.querySelector("#profile-plan").textContent = isPremium ? "Plano premium" : "Plano gratuito";
  document.querySelector("#premium-report-lock").classList.toggle("hidden", isPremium);
  document.querySelectorAll(".workout-card[data-plan='premium']").forEach(card => card.classList.toggle("locked", !isPremium));
}

function renderApp() {
  loginScreen.classList.toggle("hidden", state.loggedIn);
  appScreen.classList.toggle("hidden", !state.loggedIn);
  document.querySelector("#welcome-name").textContent = state.name;
  document.querySelector("#profile-name").textContent = state.name;
  document.querySelector("#profile-avatar").textContent = state.name.trim().charAt(0).toUpperCase() || "T";
  document.querySelector("#user-name").value = state.name;
  document.querySelector(`#login-form input[value="${state.plan}"]`).checked = true;
  document.querySelector("#reminder-setting").checked = state.preferences.reminders;
  document.querySelector("#sound-setting").checked = state.preferences.sounds;
  updateGreeting();
  buildActivityChart();
  applyAccessRules();
}

function openWorkout(button) {
  const card = button.closest(".workout-card");
  if (card?.dataset.plan === "premium" && state.plan !== "premium") {
    showToast("Este treino faz parte do plano Premium.");
    return;
  }
  const details = workoutLibrary[button.dataset.workout];
  currentWorkout = { name: button.dataset.workout, minutes: Number(button.dataset.minutes), ...details };
  document.querySelector("#modal-title").textContent = currentWorkout.name;
  document.querySelector("#modal-description").textContent = currentWorkout.description;
  document.querySelector("#workout-intro-icon").textContent = currentWorkout.icon;
  document.querySelector("#workout-steps").innerHTML = currentWorkout.steps.map(step => `<li>${step}</li>`).join("");
  document.querySelector("#finished-minutes").textContent = `${currentWorkout.minutes} ${currentWorkout.minutes === 1 ? "minuto" : "minutos"}`;
  showWorkoutStage("workout-intro");
  workoutModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeWorkout() {
  clearInterval(timerInterval);
  timerInterval = null;
  workoutModal.classList.add("hidden");
  document.body.style.overflow = "";
  currentWorkout = null;
}

function showWorkoutStage(stageId) {
  document.querySelectorAll(".workout-stage").forEach(stage => stage.classList.toggle("active", stage.id === stageId));
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function updateTimerDisplay() {
  const elapsed = totalSeconds - remainingSeconds;
  const stepIndex = Math.min(currentWorkout.steps.length - 1, Math.floor(elapsed / Math.max(1, totalSeconds) * currentWorkout.steps.length));
  const progress = totalSeconds ? elapsed / totalSeconds * 100 : 100;
  document.querySelector("#timer-value").textContent = formatTime(remainingSeconds);
  document.querySelector("#timer-progress-bar").style.width = `${progress}%`;
  document.querySelector("#active-step-title").textContent = `Etapa ${stepIndex + 1}`;
  document.querySelector("#modal-instruction").textContent = currentWorkout.steps[stepIndex];
  document.querySelector("#step-counter").textContent = `Etapa ${stepIndex + 1} de ${currentWorkout.steps.length}`;
}

function finishTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  remainingSeconds = 0;
  updateTimerDisplay();
  showWorkoutStage("workout-finished");
}

function startTimer() {
  totalSeconds = currentWorkout.minutes * 60;
  remainingSeconds = totalSeconds;
  timerPaused = false;
  document.querySelector("#pause-workout").textContent = "Pausar";
  document.querySelector("#timer-ring").classList.remove("paused");
  showWorkoutStage("workout-active");
  updateTimerDisplay();
  if (totalSeconds === 0) {
    finishTimer();
    return;
  }
  timerInterval = setInterval(() => {
    if (timerPaused) return;
    remainingSeconds -= 1;
    updateTimerDisplay();
    if (remainingSeconds <= 0) finishTimer();
  }, 1000);
}

function launchConfetti() {
  const layer = document.querySelector("#confetti-layer");
  const colors = ["#bef264", "#81d8f7", "#ffb86b", "#b7a1ff", "#ffffff"];
  layer.innerHTML = Array.from({ length: 72 }, (_, index) => {
    const left = Math.random() * 100;
    const delay = Math.random() * .55;
    const duration = 2.2 + Math.random() * 1.4;
    const drift = `${-90 + Math.random() * 180}px`;
    const spin = `${360 + Math.random() * 720}deg`;
    const color = colors[index % colors.length];
    return `<span class="confetti-piece" style="left:${left}%;background:${color};animation-delay:${delay}s;--fall-duration:${duration}s;--drift:${drift};--spin:${spin}"></span>`;
  }).join("");
  setTimeout(() => { layer.innerHTML = ""; }, 4200);
}

document.querySelector("#login-form").addEventListener("submit", event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.name = String(form.get("name")).trim() || "Visitante";
  state.plan = String(form.get("plan"));
  state.loggedIn = true;
  saveState();
  renderApp();
  switchView("home");
});

document.querySelectorAll("[data-view-target]").forEach(button => button.addEventListener("click", () => switchView(button.dataset.viewTarget)));

document.querySelectorAll(".start-workout").forEach(button => button.addEventListener("click", () => openWorkout(button)));

document.querySelector("#begin-workout").addEventListener("click", startTimer);
document.querySelector("#pause-workout").addEventListener("click", event => {
  timerPaused = !timerPaused;
  event.currentTarget.textContent = timerPaused ? "Continuar" : "Pausar";
  document.querySelector("#timer-ring").classList.toggle("paused", timerPaused);
});
document.querySelector("#modal-close").addEventListener("click", closeWorkout);
document.querySelectorAll(".cancel-workout").forEach(button => button.addEventListener("click", closeWorkout));
workoutModal.addEventListener("click", event => { if (event.target === workoutModal) closeWorkout(); });

document.querySelector("#complete-workout").addEventListener("click", () => {
  if (!currentWorkout) return;
  const completedName = currentWorkout.name;
  state.sessions.push({ name: currentWorkout.name, minutes: currentWorkout.minutes, day: (new Date().getDay() + 6) % 7 });
  saveState();
  buildActivityChart();
  closeWorkout();
  launchConfetti();
  showToast(`${completedName} concluído. Mandou muito bem!`);
});

document.querySelectorAll(".filter-button").forEach(button => button.addEventListener("click", () => {
  const filter = button.dataset.workoutFilter;
  document.querySelectorAll(".filter-button").forEach(item => item.classList.toggle("active", item === button));
  document.querySelectorAll(".workout-card").forEach(card => card.classList.toggle("hidden", filter !== "Todos" && card.dataset.category !== filter));
}));

document.querySelectorAll(".feeling-chip").forEach(button => button.addEventListener("click", () => {
  switchView("workouts");
  const filterButton = document.querySelector(`[data-workout-filter="${button.dataset.filter}"]`);
  filterButton.click();
}));

document.querySelectorAll(".report-tab").forEach(button => button.addEventListener("click", () => {
  const report = button.dataset.report;
  document.querySelectorAll(".report-tab").forEach(tab => {
    const selected = tab === button;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  document.querySelectorAll(".report-panel").forEach(panel => panel.classList.toggle("active", panel.dataset.reportPanel === report));
}));

document.querySelector("#upgrade-button").addEventListener("click", () => {
  state.plan = "premium";
  saveState();
  applyAccessRules();
  showToast("Acesso Premium ativado para demonstração.");
});

document.querySelector("#logout-button").addEventListener("click", () => {
  state.loggedIn = false;
  saveState();
  renderApp();
});

document.querySelector("#reminder-setting").addEventListener("change", event => {
  state.preferences.reminders = event.target.checked;
  saveState();
  showToast("Preferência salva.");
});

document.querySelector("#sound-setting").addEventListener("change", event => {
  state.preferences.sounds = event.target.checked;
  saveState();
  showToast("Preferência salva.");
});

document.querySelector("#clear-data-button").addEventListener("click", () => {
  localStorage.removeItem(storageKey);
  state = structuredClone(defaultState);
  renderApp();
  switchView("home");
  showToast("Dados locais removidos.");
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !workoutModal.classList.contains("hidden")) closeWorkout();
});

renderApp();
