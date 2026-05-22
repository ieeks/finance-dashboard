// Node-Entry für den Test-Runner. Wird in CI via `npm test` oder
// `node tests/run.node.mjs` aufgerufen — exit-Code 1 bei Fehler.
//
// Im Browser stattdessen tests/run.html öffnen.

import './matcher.test.js';
import './owners.test.js';
import { runAll } from './harness.js';

runAll();
