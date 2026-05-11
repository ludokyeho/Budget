const STORAGE_KEY = "budget-app-v1";
const PIN_KEY = "budget-pin-v1";
const SESSION_KEY = "budget-supabase-session-v1";

const expenseCategories = {
  Logement: ["Loyer", "Électricité", "Eau", "Assurance habitation", "Internet"],
  Transport: ["Carburant", "Péage", "Parking", "Assurance auto", "Entretien véhicule", "Transport en commun", "Taxi / Uber"],
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

const colors = ["#111827", "#0f766e", "#d97706", "#2563eb", "#be123c", "#7c3aed", "#4b5563", "#059669", "#c2410c"];

let state = loadLocalState();
let ui = {
  tab: "budget",
  selectedCategory: null,
  modal: null,
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
