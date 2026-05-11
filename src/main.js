const STORAGE_KEY = "budget-app-v1";
const PIN_KEY = "budget-pin-v1";
const SESSION_KEY = "budget-supabase-session-v1";

const expenseCategories = {
  Logement: ["Loyer", "Électricité", "Eau", "Assurance habitation", "Internet"],
  Transport: ["Carburant", "Péage", "Parking", "Assurance auto", "Entretien véhicule", "Transport en commun", "Train","Taxi / Uber"],
  Alimentation: ["Courses", "Restaurants", "Café", "Bars", "Snacks"],
  Santé: ["Médecin", "Pharmacie", "Mutuelle"],
  Loisirs: ["Jeux vidéo", "Sorties", "Escalade", "Vêtements", "Salle de sport", "Hobbies"],
  Abonnements: ["Spotify", "Netflix", "ChatGPT", "Amazon Prime", "SFR Ludo", "SFR Alix", "TCL"],
  Achats: ["Vêtements", "Électronique", "Maison", "Cadeaux"],
  Divers: ["Frais bancaires", "Avances", "Autres"],
  Mamaou: ["Croquettes", "Véto", "Assurance"],
};

const revenueCategories = {
  Salaires: ["Ludo", "Alix"],
  Aides: ["CAF", "Bourses", "Prime d'activité"],
  Ventes: ["Leboncoin", "Vinted", "Autres"],
  Divers: ["Cours particuliers", "Remboursements", "Autres"],
};

const colors = ["#111827", "#0f766e", "#d97706", "#2563eb", "#be123c", "#7c3aed", "#4b5563", "#059669", "#c2410c","#0284c7"];

let state = loadLocalState();
let ui = {
  tab: "budget",
  selectedCategory: null,
  modal: null,
  editingTransactionId: null,
  transactionDraft: null,
  unlocked: false,
  viewMonth: state.currentMonth,
  localMode: false,
};

let cloud = {
  session: loadSession(),
  ready: false,
  loading: false,
  saving: false,
  error: "",
  message: "",
  remoteUpdatedAt: "",
  saveTimer: null,
  pollTimer: null,
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function shiftMonth(iso, amount) {
  const date = new Date(`${iso}T12:00:00`);
  date.setMonth(date.getMonth() + amount);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function previousMonthStart(iso) {
  return shiftMonth(iso, -1);
}

function nextMonthStart(iso) {
  return shiftMonth(iso, 1);
}

function monthLabel(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

function shortMonthLabel(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { month: "short" });
}

function formatEuro(value) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value || 0);
}

function createBudgets() {
  return Object.fromEntries(Object.keys(expenseCategories).map((name) => [name, 0]));
}

function initialState() {
  const month = currentMonthStart();
  return {
    currentMonth: month,
    monthBudgets: { [month]: createBudgets() },
    transactions: [],
    monthlyHistory: [],
  };
}

function normalizeBudgets(record = {}) {
  return { ...createBudgets(), ...record };
}

function normalizeState(raw = {}) {
  const base = initialState();
  const currentMonth = raw.currentMonth || base.currentMonth;
  const monthBudgets = { ...(raw.monthBudgets || {}) };

  if (raw.budgets && !monthBudgets[currentMonth]) {
    monthBudgets[currentMonth] = raw.budgets;
  }

  monthBudgets[currentMonth] = normalizeBudgets(monthBudgets[currentMonth]);
  Object.keys(monthBudgets).forEach((month) => {
    monthBudgets[month] = normalizeBudgets(monthBudgets[month]);
  });

  const transactions = Array.isArray(raw.transactions)
    ? raw.transactions.map((tx) => ({
      ...tx,
      id: tx.id || crypto.randomUUID(),
      month: tx.month || currentMonth,
      amount: Number(tx.amount) || 0,
    }))
    : [];

  return {
    ...base,
    ...raw,
    currentMonth,
    monthBudgets,
    transactions,
    monthlyHistory: Array.isArray(raw.monthlyHistory) ? raw.monthlyHistory : [],
  };
}

function loadLocalState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return normalizeState(saved);
  } catch {
    return initialState();
  }
}

function saveState(nextState = state, options = {}) {
  state = normalizeState(nextState);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
  if (options.sync !== false) queueCloudSave();
}

function viewedMonth() {
  return ui.viewMonth || state.currentMonth;
}

function getBudgets(month = viewedMonth()) {
  return normalizeBudgets(state.monthBudgets?.[month]);
}

function transactionsForMonth(month = viewedMonth()) {
  return state.transactions.filter((tx) => tx.month === month);
}

function monthSummary(month = viewedMonth()) {
  const txs = transactionsForMonth(month);
  const expenses = txs.filter((tx) => tx.type === "expense");
  const revenues = txs.filter((tx) => tx.type === "revenue");
  const spent = expenses.reduce((sum, tx) => sum + tx.amount, 0);
  const income = revenues.reduce((sum, tx) => sum + tx.amount, 0);
  const planned = Object.values(getBudgets(month)).reduce((sum, value) => sum + Number(value || 0), 0);
  return { expenses, revenues, spent, income, planned, balance: income - spent };
}

function categorySpent(category, month = viewedMonth()) {
  return transactionsForMonth(month)
    .filter((tx) => tx.type === "expense" && tx.category === category)
    .reduce((sum, tx) => sum + tx.amount, 0);
}

function knownMonths() {
  const months = new Set([
    state.currentMonth,
    viewedMonth(),
    ...Object.keys(state.monthBudgets || {}),
    ...state.monthlyHistory.map((month) => month.month),
    ...state.transactions.map((tx) => tx.month),
  ]);
  return [...months].filter(Boolean).sort();
}

function cumulativeBalance(month = viewedMonth()) {
  return knownMonths()
    .filter((knownMonth) => knownMonth <= month)
    .reduce((sum, knownMonth) => sum + monthSummary(knownMonth).balance, 0);
}

function personTotals(month = viewedMonth()) {
  return transactionsForMonth(month)
    .filter((tx) => tx.type === "expense")
    .reduce((totals, tx) => {
      const person = tx.person || "Commun";
      totals[person] = (totals[person] || 0) + tx.amount;
      return totals;
    }, { Ludo: 0, Alix: 0, Commun: 0 });
}

function defaultTransactionDate() {
  return viewedMonth() === state.currentMonth ? today() : viewedMonth();
}

function createTransactionDraft(type, tx = null) {
  const categoryMap = type === "expense" ? expenseCategories : revenueCategories;
  const firstCategory = Object.keys(categoryMap)[0];
  const category = tx?.category && categoryMap[tx.category] ? tx.category : firstCategory;
  const subcategory = tx?.subcategory && categoryMap[category].includes(tx.subcategory)
    ? tx.subcategory
    : categoryMap[category][0];

  return {
    date: tx?.date || defaultTransactionDate(),
    amount: tx ? String(tx.amount).replace(".", ",") : "",
    category,
    subcategory,
    comment: tx?.comment || "",
    person: tx?.person || "Commun",
  };
}

function openTransactionModal(type, tx = null) {
  ui.modal = type;
  ui.editingTransactionId = tx?.id || null;
  ui.transactionDraft = createTransactionDraft(type, tx);
  render();
}

function closeTransactionModal() {
  ui.modal = null;
  ui.editingTransactionId = null;
  ui.transactionDraft = null;
  render();
}

function updateTransactionDraftFromForm(form) {
  if (!form) return;
  const type = form.dataset.type;
  const categoryMap = type === "expense" ? expenseCategories : revenueCategories;
  const category = form.elements.category.value;
  const subcategory = form.elements.subcategory.value || categoryMap[category][0];
  ui.transactionDraft = {
    date: form.elements.date.value,
    amount: form.elements.amount.value,
    category,
    subcategory,
    comment: form.elements.comment.value,
    person: type === "expense" ? form.elements.person.value : "",
  };
}

function getSupabaseConfig() {
  const config = window.BUDGET_SUPABASE || {};
  return {
    url: String(config.url || "").replace(/\/$/, ""),
    publishableKey: String(config.publishableKey || config.anonKey || ""),
  };
}

function cloudConfigured() {
  const config = getSupabaseConfig();
  return Boolean(config.url && config.publishableKey);
}

function shouldUseCloud() {
  return cloudConfigured() && !ui.localMode;
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function storeSession(session) {
  cloud.session = session;
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

async function supabaseRequest(path, options = {}) {
  const config = getSupabaseConfig();
  const headers = {
    apikey: config.publishableKey,
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (options.auth !== false && cloud.session?.access_token) {
    headers.Authorization = `Bearer ${cloud.session.access_token}`;
  }

  const response = await fetch(`${config.url}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 401 && options.auth !== false && await refreshSession()) {
    return supabaseRequest(path, options);
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || payload?.error_description || String(payload || text || "Erreur Supabase"));
  }

  return payload;
}

async function signIn(email, password) {
  const session = await supabaseRequest("/auth/v1/token?grant_type=password", {
    method: "POST",
    auth: false,
    body: { email, password },
  });
  storeSession(session);
  cloud.ready = false;
  cloud.error = "";
  cloud.message = "";
  render();
}

async function signUp(email, password) {
  const result = await supabaseRequest("/auth/v1/signup", {
    method: "POST",
    auth: false,
    body: { email, password },
  });

  if (result?.access_token) {
    storeSession(result);
    cloud.ready = false;
    cloud.error = "";
    cloud.message = "";
  } else {
    cloud.message = "Compte créé. Si Supabase demande une confirmation email, valide le lien puis connecte-toi.";
  }
  render();
}

async function refreshSession() {
  if (!cloud.session?.refresh_token) return false;
  try {
    const session = await supabaseRequest("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      auth: false,
      body: { refresh_token: cloud.session.refresh_token },
    });
    storeSession(session);
    return true;
  } catch {
    storeSession(null);
    cloud.ready = false;
    return false;
  }
}

async function signOut() {
  try {
    if (cloud.session) {
      await supabaseRequest("/auth/v1/logout", { method: "POST", body: {} });
    }
  } catch {
    // A failed logout call should not trap the user locally.
  }
  stopCloudPolling();
  storeSession(null);
  cloud.ready = false;
  cloud.error = "";
  ui.unlocked = false;
  render();
}

function queueCloudSave() {
  if (!shouldUseCloud() || !cloud.ready) return;
  clearTimeout(cloud.saveTimer);
  cloud.saveTimer = setTimeout(() => {
    pushCloudState().catch((error) => {
      cloud.error = error.message;
      render();
    });
  }, 450);
}

async function ensureCloudLoaded() {
  if (!shouldUseCloud() || !cloud.session || cloud.ready || cloud.loading) return;
  cloud.loading = true;
  cloud.error = "";

  try {
    await pullCloudState({ initializeIfEmpty: true });
    cloud.ready = true;
    startCloudPolling();
  } catch (error) {
    cloud.error = error.message;
  } finally {
    cloud.loading = false;
    render();
  }
}

async function pullCloudState(options = {}) {
  const rows = await supabaseRequest("/rest/v1/budget_state?id=eq.shared&select=data,updated_at", {
    headers: { Accept: "application/json" },
  });

  const row = Array.isArray(rows) ? rows[0] : null;
  const hasRemoteData = row?.data && Object.keys(row.data).length > 0;

  if (!row || !hasRemoteData) {
    if (options.initializeIfEmpty) {
      await pushCloudState();
      return;
    }
    return;
  }

  if (row.updated_at === cloud.remoteUpdatedAt) return;

  cloud.remoteUpdatedAt = row.updated_at;
  cloud.error = "";
  const previousViewMonth = ui.viewMonth;
  state = normalizeState(row.data);
  ui.viewMonth = knownMonths().includes(previousViewMonth) ? previousViewMonth : state.currentMonth;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function pushCloudState() {
  if (!shouldUseCloud() || !cloud.session) return;
  cloud.saving = true;
  render();
  try {
    const rows = await supabaseRequest("/rest/v1/budget_state?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: { id: "shared", data: state },
    });
    const row = Array.isArray(rows) ? rows[0] : null;
    cloud.remoteUpdatedAt = row?.updated_at || cloud.remoteUpdatedAt;
    cloud.error = "";
  } finally {
    cloud.saving = false;
    render();
  }
}

function startCloudPolling() {
  stopCloudPolling();
  cloud.pollTimer = setInterval(() => {
    if (!cloud.saving) {
      pullCloudState().then(render).catch((error) => {
        cloud.error = error.message;
        render();
      });
    }
  }, 12000);
}

function stopCloudPolling() {
  clearInterval(cloud.pollTimer);
  cloud.pollTimer = null;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function icon(name) {
  const icons = {
    next: "&rsaquo;",
    back: "&lsaquo;",
    up: "&nearr;",
    down: "&searr;",
    target: "&#9678;",
    calendar: "&#9638;",
    pie: "&#9684;",
    plus: "+",
    trash: "&times;",
    lock: "&#9022;",
    wallet: "&#9636;",
    coin: "&euro;",
    reset: "&#8635;",
  };
  return `<span class="symbol" aria-hidden="true">${icons[name] || ""}</span>`;
}

function render() {
  const root = document.getElementById("root");

  if (!cloudConfigured() && !ui.localMode) {
    root.innerHTML = renderConfigGate();
    bindConfigGate();
    return;
  }

  if (shouldUseCloud() && !cloud.session) {
    root.innerHTML = renderAuthGate();
    bindAuthGate();
    return;
  }

  if (shouldUseCloud() && !cloud.ready) {
    root.innerHTML = renderLoadingGate();
    ensureCloudLoaded();
    return;
  }

  if (!ui.unlocked) {
    root.innerHTML = renderPinGate();
    bindPinGate();
    return;
  }

  root.innerHTML = `
    <main class="app-shell ${ui.selectedCategory ? "detail-open" : ""}">
      <header class="topbar">
        <button class="icon-button" title="Mois précédent" data-action="prev-month">${icon("back")}</button>
        <div class="month-title">
          <span class="eyebrow">${viewedMonth() === state.currentMonth ? "Mois actif" : "Mois consulté"}</span>
          <h1>${monthLabel(viewedMonth())}</h1>
        </div>
        <button class="icon-button" title="Mois suivant" data-action="next-month" ${viewedMonth() >= state.currentMonth ? "disabled" : ""}>${icon("next")}</button>
      </header>
      <div class="month-actions">
        <div class="sync-row">
          <span class="sync-pill ${cloud.error ? "sync-error" : ""}">${renderSyncLabel()}</span>
          ${shouldUseCloud() ? `<button class="text-button" data-action="logout">Déconnexion</button>` : ""}
        </div>
        ${viewedMonth() === state.currentMonth
          ? `<button class="month-cta" data-action="close-month">Commencer le mois suivant</button>`
          : `<button class="month-cta secondary-cta" data-action="go-current">Revenir au mois actif</button>`}
      </div>
      ${ui.tab === "budget" ? renderBudgetView() : renderTransactionsView()}
      <nav class="bottom-nav">
        <button class="${ui.tab === "budget" ? "active" : ""}" data-tab="budget">${icon("wallet")} Budget</button>
        <button class="${ui.tab === "transactions" ? "active" : ""}" data-tab="transactions">${icon("coin")} Transactions</button>
      </nav>
      ${ui.modal ? renderTransactionModal(ui.modal) : ""}
    </main>
  `;
  bindApp();
}

function renderSyncLabel() {
  if (ui.localMode) return "Mode local";
  if (cloud.error) return `Synchro à vérifier : ${escapeHtml(cloud.error)}`;
  if (cloud.saving) return "Synchronisation...";
  return "Synchronisé à deux";
}

function renderConfigGate() {
  return `
    <main class="lock-screen">
      <section class="lock-card setup-card">
        <div class="lock-icon">${icon("lock")}</div>
        <h1>Activer la synchro</h1>
        <p>Ajoute l'URL Supabase et la clé anon dans <strong>src/config.js</strong>, puis recharge l'app.</p>
        <div class="setup-code">
          <span>window.BUDGET_SUPABASE = {</span>
          <span>&nbsp;&nbsp;url: "https://...supabase.co",</span>
          <span>&nbsp;&nbsp;publishableKey: "sb_publishable_...",</span>
          <span>};</span>
        </div>
        <button class="primary" data-action="reload">Recharger</button>
        <button class="secondary" data-action="local-mode">Continuer en local temporairement</button>
      </section>
    </main>
  `;
}

function renderAuthGate() {
  return `
    <main class="lock-screen">
      <section class="lock-card">
        <div class="lock-icon">${icon("coin")}</div>
        <h1>Connexion</h1>
        <p>Connecte-toi avec le compte Budget. Crée d'abord les deux comptes, puis désactive les inscriptions publiques dans Supabase.</p>
        <form id="auth-form">
          <label>Email<input name="email" type="email" autocomplete="email" required /></label>
          <label>Mot de passe<input name="password" type="password" autocomplete="current-password" minlength="6" required /></label>
          ${cloud.error ? `<span class="error">${escapeHtml(cloud.error)}</span>` : ""}
          ${cloud.message ? `<span class="success">${escapeHtml(cloud.message)}</span>` : ""}
          <button class="primary" type="submit" data-auth-mode="login">Se connecter</button>
          <button class="secondary" type="button" data-auth-mode="signup">Créer un compte</button>
        </form>
      </section>
    </main>
  `;
}

function renderLoadingGate() {
  return `
    <main class="lock-screen">
      <section class="lock-card">
        <div class="lock-icon">${icon("reset")}</div>
        <h1>Synchronisation</h1>
        <p>${cloud.error ? escapeHtml(cloud.error) : "Chargement du budget partagé..."}</p>
        ${cloud.error ? `<button class="primary" data-action="retry-sync">Réessayer</button><button class="secondary" data-action="logout">Déconnexion</button>` : ""}
      </section>
    </main>
  `;
}

function renderPinGate(error = "") {
  const hasPin = Boolean(localStorage.getItem(PIN_KEY));
  return `
    <main class="lock-screen">
      <section class="lock-card">
        <div class="lock-icon">${icon("lock")}</div>
        <h1>Budget</h1>
        <p>${hasPin ? "Entre le code PIN pour ouvrir l'app." : "Crée un code PIN pour protéger les données sur cet appareil."}</p>
        <form id="pin-form">
          <input autofocus inputmode="numeric" maxlength="8" placeholder="Code PIN" type="password" id="pin-input" />
          ${error ? `<span class="error">${error}</span>` : ""}
          <button class="primary" type="submit">Continuer</button>
        </form>
      </section>
    </main>
  `;
}

function bindConfigGate() {
  document.querySelector("[data-action='reload']")?.addEventListener("click", () => window.location.reload());
  document.querySelector("[data-action='local-mode']")?.addEventListener("click", () => {
    ui.localMode = true;
    render();
  });
}

function bindAuthGate() {
  const form = document.getElementById("auth-form");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    cloud.error = "";
    signIn(email, password).catch((error) => {
      cloud.error = error.message;
      render();
    });
  });

  document.querySelector("[data-auth-mode='signup']")?.addEventListener("click", () => {
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    cloud.error = "";
    if (!email || password.length < 6) {
      cloud.error = "Entre un email et un mot de passe de 6 caractères minimum.";
      render();
      return;
    }
    signUp(email, password).catch((error) => {
      cloud.error = error.message;
      render();
    });
  });
}

function bindPinGate() {
  const form = document.getElementById("pin-form");
  const input = document.getElementById("pin-input");
  input?.focus();
  input?.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "");
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const pin = input.value;
    const saved = localStorage.getItem(PIN_KEY);
    if (pin.length < 4) {
      document.getElementById("root").innerHTML = renderPinGate("Le code doit contenir au moins 4 chiffres.");
      bindPinGate();
      return;
    }
    if (!saved) {
      localStorage.setItem(PIN_KEY, pin);
      ui.unlocked = true;
      render();
      return;
    }
    if (pin === saved) {
      ui.unlocked = true;
      render();
      return;
    }
    document.getElementById("root").innerHTML = renderPinGate("Code incorrect.");
    bindPinGate();
  });
}

function renderBudgetView() {
  const summary = monthSummary();
  const yearly = knownMonths().slice(-12);
  const people = personTotals();
  return `
    <section class="screen">
      <div class="hero-metrics">
        ${renderMetric("up", "Revenus réels", formatEuro(summary.income))}
        ${renderMetric("target", "Reste à vivre", formatEuro(summary.balance), summary.balance < 0 ? "negative" : "")}
        ${renderMetric("down", "Dépenses", formatEuro(summary.spent))}
      </div>
      <section class="balance-card ${summary.balance < 0 ? "negative" : ""}">
        <span>Solde réel du mois</span>
        <strong>${formatEuro(summary.balance)}</strong>
        <small>Surplus / dette cumulée avec ce mois : ${formatEuro(cumulativeBalance())}</small>
      </section>
      <section class="year-strip">
        <div class="section-title">${icon("calendar")}<h2>Tracker annuel</h2></div>
        <div class="bars">
          ${yearly.length ? yearly.map(renderYearItem).join("") : `<p class="muted">Les mois clôturés apparaîtront ici.</p>`}
        </div>
      </section>
      <section class="people-strip">
        <div class="person-pill"><span>Ludo</span><strong>${formatEuro(people.Ludo)}</strong></div>
        <div class="person-pill"><span>Alix</span><strong>${formatEuro(people.Alix)}</strong></div>
        <div class="person-pill"><span>Commun</span><strong>${formatEuro(people.Commun)}</strong></div>
      </section>
      <section class="category-list">
        <div class="section-title">${icon("pie")}<h2>Catégories</h2></div>
        ${Object.keys(expenseCategories).map(renderCategoryRow).join("")}
      </section>
      ${ui.selectedCategory ? renderDetailPanel(ui.selectedCategory) : ""}
    </section>
  `;
}

function renderMetric(iconName, label, value, tone = "") {
  return `<article class="metric ${tone}"><span>${icon(iconName)}</span><small>${label}</small><strong>${value}</strong></article>`;
}

function renderYearItem(month) {
  const summary = monthSummary(month);
  const height = Math.min(100, Math.abs(summary.balance) / 30 + 12);
  return `
    <button class="year-item ${month === viewedMonth() ? "selected" : ""}" data-view-month="${month}">
      <span>${shortMonthLabel(month)}</span>
      <div class="mini-bar"><i style="height:${height}%" class="${summary.balance < 0 ? "down" : "up"}"></i></div>
      <small>${formatEuro(summary.balance)}</small>
    </button>
  `;
}

function renderCategoryRow(category) {
  const budgets = getBudgets();
  const spent = categorySpent(category);
  const budget = Number(budgets[category] || 0);
  const remaining = budget - spent;
  const progress = budget > 0 ? Math.min(100, (spent / budget) * 100) : spent > 0 ? 100 : 0;
  return `
    <article class="category-row" data-category="${escapeHtml(category)}">
      <div class="row-head">
        <div>
          <strong>${category}</strong>
          <button class="detail-chip" data-category-open="${escapeHtml(category)}" type="button">Détail</button>
        </div>
        <input aria-label="Budget ${category}" inputmode="decimal" value="${budgets[category] || ""}" placeholder="0" data-budget="${escapeHtml(category)}" />
      </div>
      <div class="progress"><i style="width:${progress}%" class="${remaining < 0 ? "over" : ""}"></i></div>
      <div class="row-meta"><span>Réel ${formatEuro(spent)}</span><span>Reste ${formatEuro(remaining)}</span></div>
    </article>
  `;
}

function renderDetailPanel(category) {
  const budgets = getBudgets();
  const details = buildSubcategoryData(category);
  const total = details.reduce((sum, item) => sum + item.value, 0);
  const budget = Number(budgets[category] || 0);
  const remaining = budget - total;
  const categoryTxs = transactionsForMonth()
    .filter((tx) => tx.type === "expense" && tx.category === category)
    .sort((a, b) => b.date.localeCompare(a.date));
  const conic = details.length
    ? details.map((item, index) => {
      const start = details.slice(0, index).reduce((sum, entry) => sum + entry.value, 0) / total * 360;
      const end = start + item.value / total * 360;
      return `${colors[index % colors.length]} ${start}deg ${end}deg`;
    }).join(", ")
    : "#e8ebe3 0deg 360deg";

  return `
    <aside class="detail-panel">
      <div class="panel-header">
        <button class="icon-button" data-action="close-detail">${icon("back")}</button>
        <div>
          <span class="eyebrow">${monthLabel(viewedMonth())}</span>
          <h2>${category}</h2>
        </div>
      </div>
      <div class="detail-metrics">
        <div><span>Prévu</span><strong>${formatEuro(budget)}</strong></div>
        <div><span>Réel</span><strong>${formatEuro(total)}</strong></div>
        <div><span>Reste</span><strong class="${remaining < 0 ? "expense" : ""}">${formatEuro(remaining)}</strong></div>
      </div>
      <div class="chart-wrap">
        ${details.length ? `<div class="donut" style="background:conic-gradient(${conic})"><span>${formatEuro(total)}</span></div>` : `<p class="muted">Aucune dépense dans cette catégorie.</p>`}
      </div>
      <section class="sub-list">
        <h3>Sous-catégories</h3>
        ${expenseCategories[category].map((sub, index) => renderSubcategoryRow(sub, details, total, index)).join("")}
      </section>
      <section class="panel-transactions">
        <h3>Dépenses</h3>
        ${categoryTxs.length ? categoryTxs.map(renderPanelTransaction).join("") : `<p class="muted">Aucune ligne pour ce mois.</p>`}
      </section>
    </aside>
  `;
}

function renderSubcategoryRow(subcategory, details, total, index) {
  const detail = details.find((item) => item.name === subcategory);
  const spent = detail?.value || 0;
  const count = detail?.count || 0;
  const percent = total > 0 ? Math.round((spent / total) * 100) : 0;
  return `
    <div class="sub-row">
      <span><i style="background:${colors[index % colors.length]}"></i>${subcategory}</span>
      <strong>${formatEuro(spent)}</strong>
      <small>${count} opération${count > 1 ? "s" : ""} · ${percent}%</small>
      <div class="sub-progress"><b style="width:${percent}%"></b></div>
    </div>
  `;
}

function renderPanelTransaction(tx) {
  const date = new Date(`${tx.date}T12:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  return `
    <article class="panel-tx">
      <div>
        <strong>${escapeHtml(tx.subcategory)}</strong>
        <span>${date}${tx.person ? ` · ${escapeHtml(tx.person)}` : ""}</span>
        ${tx.comment ? `<small>${escapeHtml(tx.comment)}</small>` : ""}
      </div>
      <div class="panel-tx-actions">
        <b>${formatEuro(tx.amount)}</b>
        <button class="small-action" data-edit="${tx.id}" title="Modifier">Modifier</button>
      </div>
    </article>
  `;
}

function buildSubcategoryData(category) {
  const totals = {};
  transactionsForMonth()
    .filter((tx) => tx.type === "expense" && tx.category === category)
    .forEach((tx) => {
      if (!totals[tx.subcategory]) totals[tx.subcategory] = { name: tx.subcategory, value: 0, count: 0 };
      totals[tx.subcategory].value += tx.amount;
      totals[tx.subcategory].count += 1;
    });
  return Object.values(totals);
}

function renderTransactionsView() {
  const transactions = [...transactionsForMonth()].sort((a, b) => b.date.localeCompare(a.date));
  return `
    <section class="screen">
      <div class="action-pair">
        <button class="primary" data-modal="expense">${icon("plus")} Ajouter une dépense</button>
        <button class="secondary" data-modal="revenue">${icon("plus")} Ajouter un revenu</button>
      </div>
      <section class="transaction-list">
        ${transactions.length ? transactions.map(renderTransaction).join("") : `<div class="empty-state">${icon("reset")}<p>Aucune transaction pour ce mois.</p></div>`}
      </section>
    </section>
  `;
}

function renderTransaction(tx) {
  const date = new Date(`${tx.date}T12:00:00`).toLocaleDateString("fr-FR");
  return `
    <article class="tx-row">
      <div>
        <strong>${escapeHtml(tx.category)} · ${escapeHtml(tx.subcategory)}</strong>
        <span>${date}${tx.person ? ` · ${escapeHtml(tx.person)}` : ""}</span>
        ${tx.comment ? `<small>${escapeHtml(tx.comment)}</small>` : ""}
      </div>
      <aside>
        <b class="${tx.type === "expense" ? "expense" : "revenue"}">${tx.type === "expense" ? "-" : "+"}${formatEuro(tx.amount)}</b>
        <div class="tx-actions">
          <button class="small-action" data-edit="${tx.id}" title="Modifier">Modifier</button>
          <button class="icon-button danger" data-delete="${tx.id}" title="Supprimer">${icon("trash")}</button>
        </div>
      </aside>
    </article>
  `;
}

function renderTransactionModal(type) {
  const categoryMap = type === "expense" ? expenseCategories : revenueCategories;
  if (!ui.transactionDraft) ui.transactionDraft = createTransactionDraft(type);
  const draft = ui.transactionDraft;
  const editing = Boolean(ui.editingTransactionId);
  return `
    <div class="modal-backdrop">
      <form class="modal" id="transaction-form" data-type="${type}">
        <header>
          <div>
            <span class="eyebrow">${monthLabel(viewedMonth())}</span>
            <h2>${editing ? "Modifier" : "Ajouter"} ${type === "expense" ? "une dépense" : "un revenu"}</h2>
          </div>
          <button type="button" class="icon-button" data-action="close-modal">×</button>
        </header>
        <label>Date<input name="date" type="date" value="${escapeHtml(draft.date)}" /></label>
        <label>Montant<input name="amount" inputmode="decimal" placeholder="0,00" value="${escapeHtml(draft.amount)}" /></label>
        <label>Catégorie<select name="category">${Object.keys(categoryMap).map((cat) => `<option value="${escapeHtml(cat)}" ${cat === draft.category ? "selected" : ""}>${cat}</option>`).join("")}</select></label>
        <label>Sous-catégorie<select name="subcategory">${categoryMap[draft.category].map((sub) => `<option value="${escapeHtml(sub)}" ${sub === draft.subcategory ? "selected" : ""}>${sub}</option>`).join("")}</select></label>
        ${type === "expense" ? `<label>Pour qui ?<select name="person">${["Commun", "Ludo", "Alix"].map((person) => `<option value="${person}" ${person === draft.person ? "selected" : ""}>${person}</option>`).join("")}</select></label>` : ""}
        <label>Commentaire<textarea name="comment" rows="3">${escapeHtml(draft.comment)}</textarea></label>
        <button class="primary" type="submit">${editing ? "Enregistrer les modifications" : type === "expense" ? "Enregistrer la dépense" : "Enregistrer le revenu"}</button>
      </form>
    </div>
  `;
}

function bindApp() {
  document.querySelector("[data-action='logout']")?.addEventListener("click", signOut);

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.tab = button.dataset.tab;
      ui.selectedCategory = null;
      render();
    });
  });

  document.querySelector("[data-action='prev-month']")?.addEventListener("click", () => {
    ui.viewMonth = previousMonthStart(viewedMonth());
    ui.selectedCategory = null;
    render();
  });

  document.querySelector("[data-action='next-month']")?.addEventListener("click", () => {
    if (viewedMonth() < state.currentMonth) {
      ui.viewMonth = nextMonthStart(viewedMonth());
      ui.selectedCategory = null;
      render();
    }
  });

  document.querySelector("[data-action='go-current']")?.addEventListener("click", () => {
    ui.viewMonth = state.currentMonth;
    ui.selectedCategory = null;
    render();
  });

  document.querySelector("[data-action='close-month']")?.addEventListener("click", () => {
    const activeMonth = state.currentMonth;
    const summary = monthSummary(activeMonth);
    const nextMonth = nextMonthStart(activeMonth);
    const monthBudgets = {
      ...state.monthBudgets,
      [activeMonth]: getBudgets(activeMonth),
      [nextMonth]: state.monthBudgets?.[nextMonth] ? normalizeBudgets(state.monthBudgets[nextMonth]) : createBudgets(),
    };

    ui.viewMonth = nextMonth;
    ui.selectedCategory = null;
    saveState({
      ...state,
      currentMonth: nextMonth,
      monthBudgets,
      monthlyHistory: [
        ...state.monthlyHistory.filter((month) => month.month !== activeMonth),
        {
          month: activeMonth,
          income: summary.income,
          spent: summary.spent,
          planned: summary.planned,
          balance: summary.balance,
        },
      ].sort((a, b) => a.month.localeCompare(b.month)),
    });
  });

  document.querySelectorAll("[data-view-month]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.viewMonth = button.dataset.viewMonth;
      ui.selectedCategory = null;
      render();
    });
  });

  document.querySelectorAll("[data-budget]").forEach((input) => {
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("change", () => {
      const value = Number(input.value.replace(",", ".")) || 0;
      const month = viewedMonth();
      saveState({
        ...state,
        monthBudgets: {
          ...state.monthBudgets,
          [month]: { ...getBudgets(month), [input.dataset.budget]: value },
        },
      });
    });
  });

  document.querySelectorAll("[data-category], [data-category-open]").forEach((row) => {
    row.addEventListener("click", (event) => {
      event.stopPropagation();
      ui.selectedCategory = row.dataset.category || row.dataset.categoryOpen;
      render();
    });
  });

  document.querySelector("[data-action='close-detail']")?.addEventListener("click", () => {
    ui.selectedCategory = null;
    render();
  });

  document.querySelectorAll("[data-modal]").forEach((button) => {
    button.addEventListener("click", () => {
      openTransactionModal(button.dataset.modal);
    });
  });

  document.querySelector("[data-action='close-modal']")?.addEventListener("click", () => {
    closeTransactionModal();
  });

  document.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const tx = state.transactions.find((transaction) => transaction.id === button.dataset.edit);
      if (tx) openTransactionModal(tx.type, tx);
    });
  });

  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      saveState({ ...state, transactions: state.transactions.filter((tx) => tx.id !== button.dataset.delete) });
    });
  });

  bindTransactionForm();
}

function bindTransactionForm() {
  const form = document.getElementById("transaction-form");
  if (!form) return;
  const type = form.dataset.type;
  const categoryMap = type === "expense" ? expenseCategories : revenueCategories;
  const category = form.elements.category;
  const subcategory = form.elements.subcategory;

  const refreshSubcategories = () => {
    const allowed = categoryMap[category.value];
    const selected = allowed.includes(ui.transactionDraft?.subcategory) ? ui.transactionDraft.subcategory : allowed[0];
    subcategory.innerHTML = allowed
      .map((sub) => `<option value="${escapeHtml(sub)}" ${sub === selected ? "selected" : ""}>${sub}</option>`)
      .join("");
    subcategory.value = selected;
    updateTransactionDraftFromForm(form);
  };

  form.querySelectorAll("input, select, textarea").forEach((field) => {
    field.addEventListener("input", () => updateTransactionDraftFromForm(form));
    field.addEventListener("change", () => updateTransactionDraftFromForm(form));
  });

  category.addEventListener("change", () => {
    ui.transactionDraft = {
      ...ui.transactionDraft,
      category: category.value,
      subcategory: categoryMap[category.value][0],
    };
    refreshSubcategories();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    updateTransactionDraftFromForm(form);
    const draft = ui.transactionDraft || createTransactionDraft(type);
    const amount = Number(form.elements.amount.value.replace(",", "."));
    if (!amount || amount <= 0) return;
    const id = ui.editingTransactionId || crypto.randomUUID();
    const tx = {
      id,
      type,
      month: viewedMonth(),
      date: draft.date,
      amount,
      category: draft.category,
      subcategory: draft.subcategory,
      comment: draft.comment.trim(),
      person: type === "expense" ? draft.person : "",
    };
    const transactions = ui.editingTransactionId
      ? state.transactions.map((transaction) => transaction.id === id ? tx : transaction)
      : [tx, ...state.transactions];
    ui.modal = null;
    ui.editingTransactionId = null;
    ui.transactionDraft = null;
    saveState({ ...state, transactions });
  });
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && shouldUseCloud() && cloud.ready && !cloud.saving) {
    pullCloudState().then(render).catch((error) => {
      cloud.error = error.message;
      render();
    });
  }
});

render();
