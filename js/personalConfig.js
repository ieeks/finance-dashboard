// personalConfig.js — Persönliche Konfiguration des Konto-Inhabers.
//
// Hier landet alles was user-spezifisch ist und nicht in den allgemeinen
// Code gehört (Vermieter-Name, Schlüsselwörter aus Mietverträgen etc.).
// Damit der Code für andere Nutzer einsetzbar bleibt und Helvetia &
// Rennweg nicht durch parser.js / categories.js verstreut sind.
//
// Bei Open-Source-Veröffentlichung: Datei in personalConfig.example.js
// umbenennen und die echte Datei via .gitignore ausschließen.
//
// Für die Python-Seite gibt es ein 1:1-Mirror in gmail_finance_importer.py
// (LANDLORD-Konstante). Bei Änderungen IMMER beide Seiten anfassen.

export const LANDLORD = {
  // Vendor-Name (Hausverwalter / Eigentümer), wie er in Bankbuchungen
  // und Rechnungen erscheint.
  vendorPattern: /Helvetia/i,

  // Schlüsselwörter die eine Miete-Rechnung von einer Versicherungs-
  // Rechnung des gleichen Vendors unterscheiden. Helvetia ist hier
  // Hausverwalter, hat aber denselben Markennamen wie ein Versicherer.
  // "Rennweg" = Straßenname der Wohnung; passt ggf. an euren Fall an.
  mieteKeywords: /Vorschreibung|Miete|Betriebskosten|Hausverwaltung|Rennweg/i,
};
