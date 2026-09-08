---
name: measure-before-shipping
description: Misst die Wirkung einer Heuristik-Änderung gegen den echten Bestand, bevor sie ausgeliefert wird — Trefferquote vorher/nachher, Ursachen je verlorenem Fall, und wie viel gespeicherter Zustand beim ersten Lauf kaputtgeht. Nutze diesen Skill, sobald an Matching, Parsing, Kategorisierung, Deduplizierung, Scoring, Schwellwerten, Toleranzen oder Filterregeln geschraubt wird — auch wenn niemand nach einer Messung fragt, alle Tests grün sind und der PR gut aussieht. Ebenso bei Sätzen wie „ist das jetzt nicht zu streng", „erkennt er dann überhaupt noch was", „sollen wir das so deployen" oder wenn mehrere Regeln nacheinander verschärft wurden. Grüne Tests zeigen Korrektheit, nicht Wirkung.
---

# Wirkung messen, bevor es ausgeliefert wird

## Warum

Heuristiken werden fast immer in kleinen, je einzeln begründbaren Schritten
verschärft: ein Hard-Out hier, eine Plausibilitätsprüfung dort, ein Filter, eine
engere Toleranz. Jeder Schritt hat einen guten Grund und einen grünen Test. Die
Wirkung ist aber multiplikativ, und niemand sieht sie an einem Diff.

Konstruierte Tests beantworten „tut es, was ich meinte?". Sie beantworten nicht
„wie oft greift es im echten Bestand?". Für diese Frage gibt es nur eine
Antwort: gegen die echten Daten laufen lassen.

Ein reales Beispiel: Nach fünf einzeln vernünftigen Verschärfungen fiel die
automatische Zuordnungsquote von 66 % auf 34 %, und der erste App-Start hätte
129 von 267 gespeicherten Verknüpfungen gelöscht. Alle 200 Tests waren grün. Die
Regel, über die vorher am längsten diskutiert wurde, kostete 5 Fälle — die
teuersten beiden hatte niemand auf dem Schirm.

## Wann dieser Skill greift

Bei Änderungen an Regeln, die auf unsauberen Echtdaten entscheiden: Matching,
Zuordnung, Fuzzy-Vergleiche, Parser, Kategorisierung, Dedup, Scoring, Schwellen,
Ranking, Spam-/Plausibilitätsfilter.

Nicht nötig bei Änderungen mit genau einer richtigen Antwort — ein Off-by-one,
ein Tippfehler im Feldnamen, ein Absturz. Da genügt ein Test.

## Die vier Eigenschaften, die den Report tragen

**1. Nur lesend.** Keine Schreibpfade, Schreibfunktionen gestubbt, im Kopf des
Skripts dokumentiert. Der Report wird gegen Produktivdaten laufen — er muss
gefahrlos wiederholbar sein, sonst traut sich niemand, ihn zu benutzen.

**2. Alte Implementierung einfrieren, neue echt ausführen.** Zwei Nachbauten
gegeneinander zu vergleichen misst die Nachbauten. Nimm stattdessen eine
wortgleiche Kopie des alten Standes (`git show <ref>:<datei> > legacy/…`) und
führe den neuen Code direkt aus — importieren, oder die relevante Funktion aus
der Quelldatei ziehen und in einem Sandkasten ausführen, wenn sie nicht
exportiert ist. Bricht das später, weil sich die Funktion umbenannt hat, ist ein
lauter Abbruch besser als ein stiller Fehlvergleich.

**3. Ursachen per Sonde, nicht per Vermutung.** Die wichtigste Zahl ist nicht
„wie viel schlechter", sondern „woran genau". Für jeden verlorenen Fall: hebe
einzeln je ein Gate auf und frage erneut. Greift es dann, war dieses Gate der
Grund. Mehrfachnennung erlauben, und eine Restkategorie führen für Fälle, die
kein einzelnes Gate erklärt — die ist oft selbst ein Befund (z.B. gierige
Zuteilung, bei der ein Kandidat schon vergeben war).

**4. Was bricht am gespeicherten Zustand?** Getrennt von der Quote. Wenn die
Anwendung Ergebnisse persistiert (Verknüpfungen, Kategorien, Flags), rechne aus,
wie viel davon der erste Lauf nach dem Deploy auflösen oder überschreiben würde.
Das ist meist die eigentliche Entscheidungszahl: eine schlechtere Quote ärgert,
gelöschte Altdaten sind weg.

## Aufbau der Ausgabe

Halte dich an diese Reihenfolge — sie führt von „wie schlimm" über „woran" zu
„was kostet es mich sofort":

```
Bestand            Größe der Grundgesamtheit, damit Prozente einordbar sind
Quote              alt / neu / verloren / neu gewonnen
Ursachen           je Gate, absteigend, Mehrfachnennung erlaubt
Zusatzachse        optional: welche Datenpaare widersprechen sich (nur IDs)
Erster Lauf        was am gespeicherten Zustand erhalten bleibt / gelöst wird
```

`scripts/report_skeleton.mjs` ist ein lauffähiges Gerüst mit genau dieser
Struktur; die vier projektspezifischen Stellen sind als `TODO` markiert. Sprache
und Datenquelle sind austauschbar — die Struktur ist der Punkt.

## Datenschutz

Der Report läuft über echte Nutzerdaten und schreibt in Logs, die andere sehen.
Namen, Beträge, Adressen und Freitexte gehören nicht in die Standardausgabe.
Aggregate und IDs reichen für die Entscheidung. Beispielzeilen nur hinter einem
ausdrücklichen Schalter (`--samples <n>`), mit einem Hinweis, was sie zeigen.

Wenn eine Zusatzachse helfen würde (etwa: welche zwei Quellen sich bei einem
Feld widersprechen), gib sie als reine ID-Paare mit Häufigkeit aus — das
diagnostiziert, ohne etwas preiszugeben.

## Wo er laufen muss

Dort, wo die Zugangsdaten liegen. Wenn die Produktivdaten nur über ein
CI-Secret erreichbar sind, gehört der Report in einen manuell auslösbaren
Workflow, nicht in ein lokales Skript, das niemand starten kann.

Zwei Fallen, die dabei regelmäßig zuschlagen:

- Ein manuell auslösbarer Workflow (`workflow_dispatch`) erscheint erst, wenn
  die Datei auf dem **Default-Branch** liegt. Solange sie nur im Feature-Branch
  liegt, gibt es keinen Startknopf — auch nicht über die API. Bring das Werkzeug
  also getrennt und vorab auf den Default-Branch; es ändert am Produkt nichts.
- Beim Start muss der **Branch mit der Änderung** gewählt werden, nicht der
  Default-Branch. Sonst wird der alte Stand mit sich selbst verglichen und das
  Ergebnis sieht beruhigend aus. Baue einen Abbruch mit Klartext ein, wenn der
  ausgecheckte Stand die neuen Regeln gar nicht kennt.

Biete zusätzlich einen Offline-Weg an: einmal mit `--dump` die gelesenen Daten
sichern, danach beliebig oft mit `--input <datei>` ohne Zugangsdaten rechnen.
Das macht die Auswertung teilbar und wiederholbar.

## Ergebnisse lesen

Die teuerste Ursache ist selten die, über die diskutiert wurde. Sortiere die
Gegenmaßnahmen nach gemessenen Kosten, nicht nach Bauchgefühl:

- Teure Sperren zu Abzügen machen. Ein Widerspruch zwischen zwei Datenquellen
  ist ein Indiz, kein Beweis — er darf das Ergebnis verschieben, nicht
  ausschließen.
- Qualitätswarnungen von Sperren trennen. „Diese Daten sind unvollständig" ist
  eine Anzeige für den Menschen, kein Grund, das Ergebnis wegzuwerfen.
- Billige Verschärfungen behalten. Was fast nichts kostet und Fehler verhindert,
  bleibt.
- Gespeicherten Zustand nur aufgeben, wenn er nachweislich falsch ist — nicht,
  weil eine neue Regel ihn nicht mehr reproduzieren kann. Er ist aus einem
  früheren, bewussten Lauf entstanden.

Nach den Gegenmaßnahmen denselben Report erneut laufen lassen und gegen den
Ausgangswert vergleichen. Ohne diesen zweiten Lauf weißt du nur, dass du etwas
geändert hast.

## Was in den PR gehört

Die Rohausgabe des Reports, die Ursachenverteilung und die Zahl zum
gespeicherten Zustand — als Kommentar, nicht als Prosa-Zusammenfassung. Wer
später fragt, warum eine Regel gelockert wurde, findet dort die Messung statt
einer Meinung. Wenn eine Vermutung widerlegt wurde (auch die eigene), schreib
das dazu; das ist der Teil, den sonst niemand rekonstruieren kann.
