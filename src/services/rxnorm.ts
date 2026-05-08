import { Alert } from 'react-native';
import { getMedications, getUnenrichedMedications, updateMedicationRxInfo } from '../db/medications';
import type { DrugInfo, PillImage } from '../types';

const RXNAV   = 'https://rxnav.nlm.nih.gov/REST';
const RXIMAGE  = 'https://rximage.nlm.nih.gov/api/rximage/1';
const MLPLUS   = 'https://medlineplus.gov/druginfo';

const TIMEOUT_MS = 12_000;

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'PillReminderApp/1.0 (health app; contact via app store)' },
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ─── rxcui lookup ─────────────────────────────────────────────────────────────

export async function lookupRxcui(name: string): Promise<string | null> {
  const encoded = encodeURIComponent(name.trim());
  const data = await fetchJson<{ idGroup?: { rxnormId?: string[] } }>(
    `${RXNAV}/rxcui.json?name=${encoded}&search=1`
  );
  return data?.idGroup?.rxnormId?.[0] ?? null;
}

// ─── Drug-drug interactions ───────────────────────────────────────────────────

export interface DDIInteraction {
  drug1: string;
  drug2: string;
  severity: string;
  description: string;
}

export async function checkInteractions(rxcuis: string[]): Promise<DDIInteraction[]> {
  if (rxcuis.length < 2) return [];
  const param = rxcuis.join('+');
  const data = await fetchJson<any>(
    `${RXNAV}/interaction/list.json?rxcuis=${param}`
  );
  const results: DDIInteraction[] = [];
  const groups: any[] = data?.fullInteractionTypeGroup ?? [];
  for (const group of groups) {
    for (const fit of group.fullInteractionType ?? []) {
      for (const pair of fit.interactionPair ?? []) {
        const concepts: any[] = pair.interactionConcept ?? [];
        results.push({
          drug1: concepts[0]?.minConceptItem?.name ?? '',
          drug2: concepts[1]?.minConceptItem?.name ?? '',
          severity: pair.severity ?? 'unknown',
          description: pair.description ?? '',
        });
      }
    }
  }
  return results;
}

// ─── Drug info (MedlinePlus) ──────────────────────────────────────────────────

async function findMedlinePlusUrl(name: string): Promise<string | null> {
  const letter = name.trim()[0]?.toUpperCase();
  if (!letter) return null;

  const indexHtml = await fetchHtml(`${MLPLUS}/drug_${letter}a.html`);
  if (!indexHtml) return null;

  const lower = name.trim().toLowerCase();
  const linkRe = /<a href="(\.\/meds\/[^"]+)">([^<]+)<\/a>/gi;
  let best: string | null = null;

  for (const [, href, text] of indexHtml.matchAll(linkRe)) {
    const t = text.trim().toLowerCase();
    if (t === lower) {
      best = href;
      break;
    }
    // Fallback: drug name starts with query (e.g. "Metformin HCl" matches "metformin")
    if (!best && t.startsWith(lower)) best = href;
  }

  if (!best) return null;
  // ./meds/a696005.html → https://medlineplus.gov/druginfo/meds/a696005.html
  return `${MLPLUS}/${best.replace('./', '')}`;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function cap(text: string, max = 1500): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function extractSections(html: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const parts = html.split(/<h[23][^>]*>/i);
  for (const part of parts.slice(1)) {
    const closeIdx = part.search(/<\/h[23]>/i);
    if (closeIdx === -1) continue;
    const heading = stripTags(part.slice(0, closeIdx)).toLowerCase().trim();
    const body = cap(stripTags(part.slice(closeIdx)).trim());
    if (heading) sections[heading] = body;
  }
  return sections;
}

function find(sections: Record<string, string>, ...keywords: string[]): string | null {
  for (const [heading, content] of Object.entries(sections)) {
    if (keywords.some((k) => heading.includes(k))) return content || null;
  }
  return null;
}

export async function fetchDrugInfo(name: string): Promise<DrugInfo | null> {
  const pageUrl = await findMedlinePlusUrl(name);
  if (!pageUrl) return null;

  const html = await fetchHtml(pageUrl);
  if (!html) return null;

  const sections = extractSections(html);

  return {
    why_prescribed:       find(sections, 'why is this medication prescribed', 'why is this medicine'),
    how_to_take:          find(sections, 'how should this medicine be used', 'how should this medication be used'),
    precautions:          find(sections, 'what special precautions', 'before taking'),
    dietary_instructions: find(sections, 'dietary instructions', 'dietary'),
    missed_dose:          find(sections, 'forget a dose', 'miss a dose', 'missed dose'),
    side_effects:         find(sections, 'side effect'),
    storage_disposal:     find(sections, 'storage', 'disposal'),
    source_name: 'MedlinePlus (National Library of Medicine)',
    source_url:  pageUrl,
    fetched_at:  new Date().toISOString(),
  };
}

// ─── Pill images (RxImage) ────────────────────────────────────────────────────

export async function fetchPillImages(rxcui: string): Promise<PillImage[]> {
  const data = await fetchJson<{ nlmRxImages?: any[] }>(
    `${RXIMAGE}/rxbase?rxcui=${rxcui}`
  );
  return (data?.nlmRxImages ?? [])
    .slice(0, 8)
    .map((img: any) => ({ url: img.imageUrl as string, name: (img.name ?? '') as string }));
}

// ─── Orchestration ────────────────────────────────────────────────────────────

export async function enrichAllUnenriched(): Promise<void> {
  const meds = await getUnenrichedMedications();
  for (const med of meds) {
    await enrichMedication(med.id, med.name, med.entity_id);
    await new Promise((res) => setTimeout(res, 400));
  }
}

export async function enrichMedication(
  medId: string,
  medName: string,
  entityId: string
): Promise<void> {
  const rxcui = await lookupRxcui(medName);
  if (!rxcui) return;

  await updateMedicationRxInfo(medId, { rxcui });

  const [info, allMeds] = await Promise.all([
    fetchDrugInfo(medName),
    getMedications(entityId),
  ]);

  if (info) {
    await updateMedicationRxInfo(medId, { drug_info: JSON.stringify(info) });
  }

  const rxcuis = allMeds
    .map((m) => (m.id === medId ? rxcui : m.rxcui))
    .filter((r): r is string => !!r);

  if (rxcuis.length >= 2) {
    const interactions = await checkInteractions(rxcuis);
    if (interactions.length > 0) {
      const lines = interactions
        .slice(0, 5)
        .map((i) => `• ${i.drug1} + ${i.drug2} [${i.severity}]: ${i.description.slice(0, 120)}`)
        .join('\n\n');
      Alert.alert(
        '⚠️ Drug Interactions Found',
        `${interactions.length} interaction${interactions.length > 1 ? 's' : ''} detected for ${medName}:\n\n${lines}`,
        [{ text: 'OK' }],
        { cancelable: true }
      );
    }
  }
}
