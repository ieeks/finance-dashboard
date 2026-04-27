// firebase-config.js — Firebase Projektkonfiguration
// Dieses File ist im Repo (Firebase Config ist public-safe — Sicherheit via Security Rules + Auth).
// API Keys (Anthropic/OpenAI) werden in Firestore gespeichert, nie hier eintragen.

export const firebaseConfig = {
  apiKey:            "HIER_EINTRAGEN",
  authDomain:        "HIER_EINTRAGEN",
  projectId:         "HIER_EINTRAGEN",
  storageBucket:     "HIER_EINTRAGEN",
  messagingSenderId: "HIER_EINTRAGEN",
  appId:             "HIER_EINTRAGEN",
};

export const ALLOWED_EMAILS = [
  "manuel.koblischek@gmail.com",
  "zolguita@gmail.com",
];
