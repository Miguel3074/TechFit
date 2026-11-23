const tokenKey = "techfit-auth-token";
const apiBaseUrl = globalThis.TECHFIT_API_URL || "";

const defaultState = {
  name: "",
  email: "",
  plan: "free",
  loggedIn: false,
  sessions: [],
  comfortEntries: [],
  preferences: { reminders: true, sounds: false, reminderMinutes: 90, nextReminderAt: null }
};

const workoutLibrary = {
  "Destrave as costas": {
    icon: "⌁",
    minutes: 6,
    plan: "free",
    description: "Mobilidade suave para aliviar a região lombar depois de muito tempo sentado.",
    steps: [
      "Sente-se na ponta da cadeira, apoie os pés no chão e alongue a coluna.",
      "Incline o tronco lentamente para frente e volte, mantendo o abdômen firme.",
      "Gire o tronco para cada lado sem mover o quadril e respire profundamente."
    ]
  },
  "Reset para os punhos": {
    icon: "◇",
    minutes: 5,
    plan: "free",
    description: "Uma pausa para relaxar mãos, dedos e antebraços depois de usar teclado e mouse.",
    steps: [
      "Estenda um braço com a palma para cima e puxe os dedos suavemente para baixo.",
      "Faça círculos lentos com os punhos nos dois sentidos.",
      "Abra e feche as mãos devagar, alongando bem os dedos a cada repetição."
    ]
  },
  "Pescoço sem tensão": {
    icon: "◯",
    minutes: 8,
    plan: "premium",
    description: "Respiração e mobilidade controlada para reduzir a tensão nos ombros e na cervical.",
    steps: [
      "Sente-se com a coluna ereta e solte os ombros enquanto respira fundo.",
      "Incline a cabeça em direção a um ombro, sem levantar o ombro oposto.",
      "Olhe lentamente para a direita e para a esquerda, sem forçar o movimento."
    ]
  },
  "Fim de expediente": {
    icon: "✦",
    minutes: 10,
    plan: "premium",
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
const loadingScreen = document.querySelector("#loading-screen");
let state = cloneDefaultState();
let authToken = localStorage.getItem(tokenKey) || "";
let currentWorkout = null;
let toastTimeout = null;
let timerInterval = null;
let reminderTimeout = null;
let remainingSeconds = 0;
let totalSeconds = 0;
let timerEndAt = 0;
let timerPaused = false;
let activeStepIndex = -1;
let audioContext = null;

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(defaultState));
}

function clampScore(value) {
  return Math.min(10, Math.max(0, Number(value) || 0));
}

async function apiRequest(path, options = {}) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Não foi possível concluir a operação.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function applyUser(user) {
  state.name = user.name;
  state.email = user.email;
  state.plan = user.plan;
  state.loggedIn = true;
  state.preferences = {
    reminders: user.preferences?.reminders !== false,
    sounds: user.preferences?.sounds === true,
    reminderMinutes: 90,
    nextReminderAt: state.preferences.nextReminderAt
  };
}

function setAuthError(message = "") {
  const element = document.querySelector("#auth-error");
  element.textContent = message;
  element.classList.toggle("hidden", !message);
}

function setSubmitting(form, submitting) {
  form.querySelectorAll("input, button").forEach(element => { element.disabled = submitting; });
}

function showToast(message) {
  clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.remove("hidden");
  toastTimeout = setTimeout(() => toast.classList.add("hidden"), 3000);
}

function switchView(viewName) {
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.dataset.view === viewName));
  document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.viewTarget === viewName));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateGreeting() {
  const hour = new Date().getHours();
  document.querySelector("#greeting").textContent = hour < 12 ? "Bom dia," : hour < 18 ? "Boa tarde," : "Boa noite,";
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function sessionsBetween(start, end) {
  return state.sessions.filter(session => {
    const date = new Date(session.completedAt);
    return date >= start && date < end;
  });
}

function calculateStreak() {
  const sessionDays = new Set(state.sessions.map(session => localDateKey(new Date(session.completedAt))));
  let cursor = startOfDay(new Date());
  if (!sessionDays.has(localDateKey(cursor))) cursor = addDays(cursor, -1);
  if (!sessionDays.has(localDateKey(cursor))) return 0;
  let streak = 0;
  while (sessionDays.has(localDateKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function updateActivityInsight(currentSessions, previousSessions, activeDays) {
  const currentMinutes = currentSessions.reduce((sum, session) => sum + session.minutes, 0);
  const previousMinutes = previousSessions.reduce((sum, session) => sum + session.minutes, 0);
  const title = document.querySelector("#activity-insight-title");
  const text = document.querySelector("#activity-insight-text");
  const symbol = document.querySelector("#activity-insight-symbol");
  if (!currentSessions.length) {
    title.textContent = "Comece no seu ritmo";
    text.textContent = "Conclua seu primeiro treino para acompanhar sua evolução.";
    symbol.textContent = "→";
    return;
  }
  if (!previousSessions.length) {
    title.textContent = "Ótimo começo";
    text.textContent = `Você se movimentou em ${activeDays} ${activeDays === 1 ? "dia" : "dias"} nos últimos 7 dias.`;
    symbol.textContent = "✦";
    return;
  }
  const difference = currentMinutes - previousMinutes;
  if (difference > 0) {
    title.textContent = "Você avançou";
    text.textContent = `Foram ${difference} minutos a mais do que nos 7 dias anteriores.`;
    symbol.textContent = "↗";
  } else if (difference < 0) {
    title.textContent = "Retome com leveza";
    text.textContent = `Faltam ${Math.abs(difference)} minutos para alcançar o período anterior.`;
    symbol.textContent = "→";
  } else {
    title.textContent = "Ritmo consistente";
    text.textContent = "Você manteve o mesmo tempo de movimento do período anterior.";
    symbol.textContent = "=";
  }
}

function buildActivityChart() {
  const today = startOfDay(new Date());
  const days = Array.from({ length: 7 }, (_, index) => addDays(today, index - 6));
  const dayKeys = new Set(days.map(localDateKey));
  const totals = days.map(day => state.sessions.filter(session => localDateKey(new Date(session.completedAt)) === localDateKey(day)).reduce((sum, session) => sum + session.minutes, 0));
  const max = Math.max(...totals, 10);
  document.querySelector("#activity-chart").innerHTML = totals.map(value => `<span class="bar ${value > 0 ? "active" : ""}" style="height:${Math.max(4, value / max * 100)}%" data-value="${value}" aria-label="${value} minutos"></span>`).join("");
  document.querySelector("#activity-chart-legend").innerHTML = days.map(day => `<span>${new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(day).replace(".", "")}</span>`).join("");
  const currentSessions = state.sessions.filter(session => dayKeys.has(localDateKey(new Date(session.completedAt))));
  const previousSessions = sessionsBetween(addDays(today, -13), addDays(today, -6));
  const total = currentSessions.reduce((sum, session) => sum + session.minutes, 0);
  const count = currentSessions.length;
  const activeDays = new Set(currentSessions.map(session => localDateKey(new Date(session.completedAt)))).size;
  document.querySelector("#week-sessions").textContent = count;
  document.querySelector("#week-minutes").textContent = `${total} min`;
  document.querySelector("#report-total").textContent = `${total} min`;
  document.querySelector("#report-sessions").textContent = count;
  document.querySelector("#report-average").textContent = `${count ? Math.round(total / count) : 0} min`;
  document.querySelector("#streak-value").textContent = calculateStreak();
  updateActivityInsight(currentSessions, previousSessions, activeDays);
  buildRecentActivity();
}

function formatSessionDate(value) {
  const date = startOfDay(new Date(value));
  const today = startOfDay(new Date());
  const difference = Math.round((today - date) / 86400000);
  if (difference === 0) return "Hoje";
  if (difference === 1) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date).replace(".", "");
}

function buildRecentActivity() {
  const list = document.querySelector("#recent-activity-list");
  const sessions = [...state.sessions].sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt)).slice(0, 4);
  document.querySelector("#recent-activity-count").textContent = state.sessions.length ? `${state.sessions.length} no total` : "";
  if (!sessions.length) {
    list.innerHTML = '<div class="recent-activity-empty">Seus treinos concluídos aparecerão aqui.</div>';
    return;
  }
  list.innerHTML = sessions.map(session => {
    const workout = workoutLibrary[session.name];
    return `<article class="recent-activity-item"><span class="recent-activity-icon">${workout?.icon || "✓"}</span><div class="recent-activity-copy"><strong>${session.name}</strong><span>${formatSessionDate(session.completedAt)}</span></div><span class="recent-activity-minutes">${session.minutes} min</span></article>`;
  }).join("");
}

function updateRecommendation() {
  const regions = {
    lowerBack: { workout: "Destrave as costas", label: "Recomendado para lombar", reason: "Com base no seu registro" },
    wrists: { workout: "Reset para os punhos", label: "Recomendado para punhos", reason: "Com base no seu registro" },
    neck: { workout: "Pescoço sem tensão", label: "Recomendado para pescoço", reason: "Com base no seu registro" }
  };
  const latest = state.comfortEntries.at(-1);
  let recommendation = { workout: "Destrave as costas", label: "Pausa recomendada", reason: "Baixo impacto" };
  if (latest) {
    const region = Object.entries(latest.values).sort((a, b) => b[1] - a[1])[0][0];
    recommendation = regions[region];
  }
  const workout = workoutLibrary[recommendation.workout];
  const button = document.querySelector("#recommendation-button");
  document.querySelector("#recommendation-label").textContent = recommendation.label;
  document.querySelector("#recommendation-title").textContent = recommendation.workout;
  document.querySelector("#recommendation-description").textContent = workout.description;
  document.querySelector("#recommendation-minutes").textContent = `${workout.minutes} min`;
  document.querySelector("#recommendation-reason").textContent = recommendation.reason;
  button.dataset.workout = recommendation.workout;
  button.dataset.minutes = workout.minutes;
  button.dataset.plan = workout.plan;
  button.textContent = workout.plan === "premium" && state.plan !== "premium" ? "Disponível no Premium" : "Começar agora";
}

function averageComfort(entry) {
  const values = Object.values(entry.values);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function comfortStatus(score) {
  if (score === 0) return "Sem desconforto";
  if (score <= 3) return "Desconforto leve";
  if (score <= 6) return "Desconforto moderado";
  return "Desconforto intenso";
}

function comfortVariation(first, latest) {
  if (first === 0) return latest === 0 ? "0%" : `+${Math.round(latest * 10)}%`;
  const change = Math.round((first - latest) / first * 100);
  return `${change > 0 ? "−" : change < 0 ? "+" : ""}${Math.abs(change)}%`;
}

function buildComfortReport() {
  const entries = state.comfortEntries.slice(-8);
  const empty = document.querySelector("#comfort-empty");
  const trend = document.querySelector("#comfort-trend");
  const area = document.querySelector("#comfort-area");
  const points = document.querySelector("#comfort-points");
  const change = document.querySelector("#comfort-change");
  const statusList = document.querySelector("#body-status-list");
  empty.classList.toggle("hidden", entries.length > 0);
  if (!entries.length) {
    trend.setAttribute("d", "");
    area.setAttribute("d", "");
    points.innerHTML = "";
    change.textContent = "—";
    change.classList.remove("positive", "negative");
    document.querySelector("#comfort-start-label").textContent = "Primeiro registro";
    document.querySelector("#comfort-end-label").textContent = "Hoje";
    statusList.innerHTML = [["⌁", "Lombar"], ["◇", "Punhos"], ["◯", "Pescoço"]].map(([icon, label]) => `<article><span class="body-status-icon">${icon}</span><div><strong>${label}</strong><span>Sem registro</span></div><em>—</em></article>`).join("");
    return;
  }
  const coordinates = entries.map((entry, index) => ({
    x: entries.length === 1 ? 160 : index / (entries.length - 1) * 320,
    y: 135 - averageComfort(entry) / 10 * 110
  }));
  const linePath = coordinates.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  trend.setAttribute("d", linePath);
  area.setAttribute("d", `${linePath} L${coordinates.at(-1).x.toFixed(1)} 150 L${coordinates[0].x.toFixed(1)} 150 Z`);
  points.innerHTML = coordinates.map(point => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="5"></circle>`).join("");
  const first = entries[0];
  const latest = entries.at(-1);
  const firstAverage = averageComfort(first);
  const latestAverage = averageComfort(latest);
  if (entries.length === 1) {
    change.textContent = `${latestAverage.toFixed(1)}/10`;
    change.classList.remove("positive", "negative");
  } else {
    change.textContent = comfortVariation(firstAverage, latestAverage);
    change.classList.toggle("positive", latestAverage <= firstAverage);
    change.classList.toggle("negative", latestAverage > firstAverage);
  }
  const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
  document.querySelector("#comfort-start-label").textContent = dateFormatter.format(new Date(first.recordedAt));
  document.querySelector("#comfort-end-label").textContent = dateFormatter.format(new Date(latest.recordedAt));
  const regions = [
    { key: "lowerBack", icon: "⌁", label: "Lombar" },
    { key: "wrists", icon: "◇", label: "Punhos" },
    { key: "neck", icon: "◯", label: "Pescoço" }
  ];
  statusList.innerHTML = regions.map(region => {
    const score = latest.values[region.key];
    const variation = entries.length > 1 ? comfortVariation(first.values[region.key], score) : `${score}/10`;
    return `<article><span class="body-status-icon">${region.icon}</span><div><strong>${region.label}</strong><span>${comfortStatus(score)}</span></div><em>${variation}</em></article>`;
  }).join("");
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
  loadingScreen.classList.add("hidden");
  loginScreen.classList.toggle("hidden", state.loggedIn);
  appScreen.classList.toggle("hidden", !state.loggedIn);
  document.querySelector("#welcome-name").textContent = state.name || "Visitante";
  document.querySelector("#profile-name").textContent = state.name || "Visitante";
  document.querySelector("#profile-avatar").textContent = state.name.trim().charAt(0).toUpperCase() || "T";
  document.querySelector("#profile-name-input").value = state.name;
  document.querySelector("#profile-email").textContent = state.email;
  document.querySelector("#profile-plan-select").value = state.plan;
  document.querySelector("#reminder-setting").checked = state.preferences.reminders;
  document.querySelector("#sound-setting").checked = state.preferences.sounds;
  updateGreeting();
  buildActivityChart();
  buildComfortReport();
  updateRecommendation();
  applyAccessRules();
  scheduleReminder();
}

function openWorkout(button) {
  const card = button.closest(".workout-card");
  const details = workoutLibrary[button.dataset.workout];
  const requiredPlan = button.dataset.plan || card?.dataset.plan || details?.plan;
  if (requiredPlan === "premium" && state.plan !== "premium") {
    showToast("Este treino faz parte do plano Premium.");
    return;
  }
  if (!details) return;
  currentWorkout = { name: button.dataset.workout, ...details, minutes: Number(button.dataset.minutes || details.minutes) };
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
  timerPaused = false;
}

function showWorkoutStage(stageId) {
  document.querySelectorAll(".workout-stage").forEach(stage => stage.classList.toggle("active", stage.id === stageId));
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function playTone(frequency = 660, duration = 0.12) {
  if (!state.preferences.sounds) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  audioContext ||= new AudioContextClass();
  if (audioContext.state === "suspended") audioContext.resume();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.frequency.value = frequency;
  oscillator.type = "sine";
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

function updateTimerDisplay() {
  if (!currentWorkout) return;
  const elapsed = totalSeconds - remainingSeconds;
  const stepIndex = Math.min(currentWorkout.steps.length - 1, Math.floor(elapsed / Math.max(1, totalSeconds) * currentWorkout.steps.length));
  const progress = totalSeconds ? elapsed / totalSeconds * 100 : 100;
  if (activeStepIndex >= 0 && stepIndex !== activeStepIndex) playTone(740);
  activeStepIndex = stepIndex;
  document.querySelector("#timer-value").textContent = formatTime(remainingSeconds);
  document.querySelector("#timer-progress-bar").style.width = `${Math.min(100, progress)}%`;
  document.querySelector("#active-step-title").textContent = `Etapa ${stepIndex + 1}`;
  document.querySelector("#modal-instruction").textContent = currentWorkout.steps[stepIndex];
  document.querySelector("#step-counter").textContent = `Etapa ${stepIndex + 1} de ${currentWorkout.steps.length}`;
}

function finishTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  remainingSeconds = 0;
  updateTimerDisplay();
  playTone(880, 0.2);
  showWorkoutStage("workout-finished");
}

function tickTimer() {
  if (timerPaused || !currentWorkout) return;
  remainingSeconds = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
  updateTimerDisplay();
  if (remainingSeconds <= 0) finishTimer();
}

function startTimerInterval() {
  clearInterval(timerInterval);
  timerInterval = setInterval(tickTimer, 250);
}

function startTimer() {
  totalSeconds = currentWorkout.minutes * 60;
  remainingSeconds = totalSeconds;
  timerEndAt = Date.now() + totalSeconds * 1000;
  timerPaused = false;
  activeStepIndex = -1;
  document.querySelector("#pause-workout").textContent = "Pausar";
  document.querySelector("#timer-ring").classList.remove("paused");
  showWorkoutStage("workout-active");
  updateTimerDisplay();
  if (totalSeconds === 0) {
    finishTimer();
    return;
  }
  startTimerInterval();
}

function launchConfetti() {
  const layer = document.querySelector("#confetti-layer");
  const colors = ["#bef264", "#81d8f7", "#ffb86b", "#b7a1ff", "#ffffff"];
  layer.innerHTML = Array.from({ length: 72 }, (_, index) => {
    const left = Math.random() * 100;
    const delay = Math.random() * 0.55;
    const duration = 2.2 + Math.random() * 1.4;
    const drift = `${-90 + Math.random() * 180}px`;
    const spin = `${360 + Math.random() * 720}deg`;
    const color = colors[index % colors.length];
    return `<span class="confetti-piece" style="left:${left}%;background:${color};animation-delay:${delay}s;--fall-duration:${duration}s;--drift:${drift};--spin:${spin}"></span>`;
  }).join("");
  setTimeout(() => { layer.innerHTML = ""; }, 4200);
}

function triggerReminder() {
  if (!state.loggedIn || !state.preferences.reminders) return;
  showToast("Hora de uma pausa: escolha um treino rápido para se movimentar.");
  playTone(620, 0.18);
  state.preferences.nextReminderAt = Date.now() + state.preferences.reminderMinutes * 60 * 1000;
  scheduleReminder();
}

function scheduleReminder() {
  clearTimeout(reminderTimeout);
  reminderTimeout = null;
  if (!state.loggedIn || !state.preferences.reminders) return;
  if (!state.preferences.nextReminderAt) {
    state.preferences.nextReminderAt = Date.now() + state.preferences.reminderMinutes * 60 * 1000;
  }
  const delay = state.preferences.nextReminderAt - Date.now();
  reminderTimeout = setTimeout(triggerReminder, Math.max(500, Math.min(delay, 2147483647)));
}

function resetReminderClock() {
  state.preferences.nextReminderAt = state.preferences.reminders ? Date.now() + state.preferences.reminderMinutes * 60 * 1000 : null;
  scheduleReminder();
}

document.querySelectorAll("[data-auth-view]").forEach(button => button.addEventListener("click", () => {
  const view = button.dataset.authView;
  document.querySelectorAll("[data-auth-view]").forEach(tab => {
    const selected = tab === button;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  document.querySelector("#login-form").classList.toggle("hidden", view !== "login");
  document.querySelector("#register-form").classList.toggle("hidden", view !== "register");
  setAuthError();
}));

document.querySelector("#fill-demo-login").addEventListener("click", () => {
  document.querySelector('[data-auth-view="login"]').click();
  document.querySelector("#login-email").value = "premium@techfit.app";
  document.querySelector("#login-password").value = "TechFit@2026";
  document.querySelector("#login-email").focus();
});

document.querySelector("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  setSubmitting(formElement, true);
  setAuthError();
  try {
    const data = await apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
    });
    authToken = data.token;
    localStorage.setItem(tokenKey, authToken);
    applyUser(data.user);
    const bootstrap = await apiRequest("/api/bootstrap");
    state.sessions = bootstrap.sessions;
    state.comfortEntries = bootstrap.comfortEntries;
    resetReminderClock();
    renderApp();
    switchView("home");
    formElement.reset();
  } catch (error) {
    setAuthError(error.message);
  } finally {
    setSubmitting(formElement, false);
  }
});

document.querySelector("#register-form").addEventListener("submit", async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  setSubmitting(formElement, true);
  setAuthError();
  try {
    const data = await apiRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name: form.get("name"), email: form.get("email"), password: form.get("password") })
    });
    authToken = data.token;
    localStorage.setItem(tokenKey, authToken);
    applyUser(data.user);
    state.sessions = [];
    state.comfortEntries = [];
    resetReminderClock();
    renderApp();
    switchView("home");
    formElement.reset();
  } catch (error) {
    setAuthError(error.message);
  } finally {
    setSubmitting(formElement, false);
  }
});

document.querySelectorAll("[data-view-target]").forEach(button => button.addEventListener("click", () => switchView(button.dataset.viewTarget)));
document.querySelectorAll(".start-workout").forEach(button => button.addEventListener("click", () => openWorkout(button)));
document.querySelector("#begin-workout").addEventListener("click", startTimer);
document.querySelector("#pause-workout").addEventListener("click", event => {
  if (timerPaused) {
    timerPaused = false;
    timerEndAt = Date.now() + remainingSeconds * 1000;
    event.currentTarget.textContent = "Pausar";
    document.querySelector("#timer-ring").classList.remove("paused");
    startTimerInterval();
  } else {
    tickTimer();
    timerPaused = true;
    clearInterval(timerInterval);
    timerInterval = null;
    event.currentTarget.textContent = "Continuar";
    document.querySelector("#timer-ring").classList.add("paused");
  }
});
document.querySelector("#modal-close").addEventListener("click", closeWorkout);
document.querySelectorAll(".cancel-workout").forEach(button => button.addEventListener("click", closeWorkout));
workoutModal.addEventListener("click", event => { if (event.target === workoutModal) closeWorkout(); });

document.querySelector("#complete-workout").addEventListener("click", async event => {
  if (!currentWorkout) return;
  const completedName = currentWorkout.name;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const data = await apiRequest("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: currentWorkout.name })
    });
    state.sessions.push(data.session);
    resetReminderClock();
    buildActivityChart();
    closeWorkout();
    launchConfetti();
    showToast(`${completedName} concluído. Mandou muito bem!`);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll(".filter-button").forEach(button => button.addEventListener("click", () => {
  const filter = button.dataset.workoutFilter;
  document.querySelectorAll(".filter-button").forEach(item => item.classList.toggle("active", item === button));
  document.querySelectorAll(".workout-card").forEach(card => card.classList.toggle("hidden", filter !== "Todos" && card.dataset.category !== filter));
}));

document.querySelectorAll(".feeling-chip").forEach(button => button.addEventListener("click", () => {
  switchView("workouts");
  document.querySelector(`[data-workout-filter="${button.dataset.filter}"]`)?.click();
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

document.querySelectorAll("#comfort-form input[type='range']").forEach(input => input.addEventListener("input", () => {
  const outputId = { lowerBack: "lower-back-output", wrists: "wrists-output", neck: "neck-output" }[input.name];
  document.querySelector(`#${outputId}`).value = input.value;
}));

document.querySelector("#comfort-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (state.plan !== "premium") return;
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  setSubmitting(formElement, true);
  try {
    const data = await apiRequest("/api/comfort", {
      method: "POST",
      body: JSON.stringify({
        values: {
          lowerBack: clampScore(form.get("lowerBack")),
          wrists: clampScore(form.get("wrists")),
          neck: clampScore(form.get("neck"))
        }
      })
    });
    state.comfortEntries.push(data.entry);
    buildComfortReport();
    formElement.reset();
    document.querySelectorAll("#comfort-form output").forEach(output => { output.value = "0"; });
    showToast("Avaliação de bem-estar salva.");
  } catch (error) {
    showToast(error.message);
  } finally {
    setSubmitting(formElement, false);
  }
});

document.querySelector("#upgrade-button").addEventListener("click", async () => {
  try {
    const data = await apiRequest("/api/me/plan", { method: "PATCH", body: JSON.stringify({ plan: "premium" }) });
    applyUser(data.user);
    renderApp();
    showToast("Plano Premium ativado para demonstração.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#profile-name-form").addEventListener("submit", async event => {
  event.preventDefault();
  const name = String(new FormData(event.currentTarget).get("name")).trim().slice(0, 24);
  if (!name) return;
  try {
    const data = await apiRequest("/api/me", { method: "PATCH", body: JSON.stringify({ name }) });
    applyUser(data.user);
    renderApp();
    showToast("Nome atualizado.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#profile-plan-form").addEventListener("submit", async event => {
  event.preventDefault();
  const plan = new FormData(event.currentTarget).get("plan");
  try {
    const data = await apiRequest("/api/me/plan", { method: "PATCH", body: JSON.stringify({ plan }) });
    applyUser(data.user);
    renderApp();
    showToast("Plano atualizado.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  if (!workoutModal.classList.contains("hidden")) closeWorkout();
  try {
    await apiRequest("/api/auth/logout", { method: "POST" });
  } catch {}
  authToken = "";
  localStorage.removeItem(tokenKey);
  state = cloneDefaultState();
  renderApp();
  switchView("home");
});

document.querySelector("#reminder-setting").addEventListener("change", async event => {
  const previous = state.preferences.reminders;
  state.preferences.reminders = event.target.checked;
  resetReminderClock();
  try {
    await apiRequest("/api/preferences", { method: "PATCH", body: JSON.stringify(state.preferences) });
    showToast(event.target.checked ? "Lembretes ativados." : "Lembretes desativados.");
  } catch (error) {
    state.preferences.reminders = previous;
    renderApp();
    showToast(error.message);
  }
});

document.querySelector("#sound-setting").addEventListener("change", async event => {
  const previous = state.preferences.sounds;
  state.preferences.sounds = event.target.checked;
  try {
    await apiRequest("/api/preferences", { method: "PATCH", body: JSON.stringify(state.preferences) });
    if (event.target.checked) playTone();
    showToast(event.target.checked ? "Sons ativados." : "Sons desativados.");
  } catch (error) {
    state.preferences.sounds = previous;
    renderApp();
    showToast(error.message);
  }
});

document.querySelector("#clear-data-button").addEventListener("click", async () => {
  if (!window.confirm("Remover todo o histórico de treinos e bem-estar desta conta?")) return;
  try {
    await apiRequest("/api/data", { method: "DELETE" });
    state.sessions = [];
    state.comfortEntries = [];
    renderApp();
    showToast("Histórico removido.");
  } catch (error) {
    showToast(error.message);
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !workoutModal.classList.contains("hidden")) closeWorkout();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && currentWorkout && !timerPaused) tickTimer();
  if (!document.hidden && state.preferences.reminders && state.preferences.nextReminderAt <= Date.now()) triggerReminder();
});

async function initialize() {
  if (!authToken) {
    renderApp();
    return;
  }
  try {
    const data = await apiRequest("/api/bootstrap");
    applyUser(data.user);
    state.sessions = data.sessions;
    state.comfortEntries = data.comfortEntries;
  } catch (error) {
    authToken = "";
    localStorage.removeItem(tokenKey);
    state = cloneDefaultState();
    if (error.status !== 401) setAuthError(error.message);
  }
  renderApp();
}

initialize();
