#!/usr/bin/env node
// Run once to generate src/data/rxnorm-names.json
// Usage: node scripts/fetch-rxnorm.mjs
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const BASE = 'https://rxnav.nlm.nih.gov/REST';
const __dir = dirname(fileURLToPath(import.meta.url));
const OUT   = join(__dir, '..', 'src', 'data', 'rxnorm-names.json');

async function fetchConcepts(tty) {
  console.log(`  Fetching TTY=${tty}…`);
  const res = await fetch(`${BASE}/allconcepts.json?tty=${tty}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for tty=${tty}`);
  const data = await res.json();
  const concepts = data.minConceptGroup?.minConcept ?? [];
  const names = [];
  for (const c of concepts) {
    if (c.name) names.push(c.name.trim());
  }
  console.log(`  TTY=${tty}: ${names.length} names`);
  return names;
}

console.log('Fetching RxNorm drug names…');
const [ingredients, brands] = await Promise.all([
  fetchConcepts('IN'),   // generic ingredients  e.g. "ibuprofen"
  fetchConcepts('BN'),   // brand names          e.g. "Advil"
]);

// Deduplicate case-insensitively, keep first-seen casing
const seen = new Set();
const all = [];
for (const name of [...ingredients, ...brands]) {
  const key = name.toLowerCase();
  if (!seen.has(key)) {
    seen.add(key);
    all.push(name);
  }
}

// Sort case-insensitively — required for binary search in the component
all.sort((a, b) => {
  const al = a.toLowerCase(), bl = b.toLowerCase();
  return al < bl ? -1 : al > bl ? 1 : 0;
});

mkdirSync(join(__dir, '..', 'src', 'data'), { recursive: true });
writeFileSync(OUT, JSON.stringify(all));
console.log(`Done. ${all.length} unique names → ${OUT}`);
