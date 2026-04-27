// firebase-config.js — Firebase Projektkonfiguration
// Dieses File ist im Repo (Firebase Config ist public-safe — Sicherheit via Security Rules + Auth).
// API Keys (Anthropic/OpenAI) werden in Firestore gespeichert, nie hier eintragen.

export const firebaseConfig = {
  apiKey:            "AIzaSyDGFbZCeo_bRRRwiQSRfmyYSI2XfyXhcec",
  authDomain:        "finance-dashboard-6e12e.firebaseapp.com",
  projectId:         "finance-dashboard-6e12e",
  storageBucket:     "finance-dashboard-6e12e.firebasestorage.app",
  messagingSenderId: "62213154943",
  appId:             "1:62213154943:web:67119eb7f59d5c71a8374a",
};

export const ALLOWED_EMAILS = [
  "manuel.koblischek@gmail.com",
  "zolguita@gmail.com",
];
