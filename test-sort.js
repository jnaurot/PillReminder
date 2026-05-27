// Tests the dose sort stability requirement:
// order must not change when a dose's status changes from due → taken.

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

// ─── Implementations under test ───────────────────────────────────────────────

// BROKEN: what today.tsx currently does — sort by scheduledAt only,
// ties fall back to array order (which is status-based from getDosesForDate).
function sortBroken(doses) {
  return [...doses].sort((a, b) =>
    (a.scheduledAt ?? '￿').localeCompare(b.scheduledAt ?? '￿')
  );
}

// FIXED: sort by scheduledAt then medication name — both are stable across status changes.
function sortFixed(doses) {
  return [...doses].sort((a, b) =>
    (a.scheduledAt ?? '￿').localeCompare(b.scheduledAt ?? '￿') ||
    a.medication.name.localeCompare(b.medication.name)
  );
}

// ─── Simulate getDosesForDate output (status-sorted) ─────────────────────────

const STATUS_ORDER = { missed: 0, due: 1, locked: 2, upcoming: 3, taken: 4, skipped: 5 };

function statusSort(doses) {
  return [...doses].sort((a, b) => {
    const so = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (so !== 0) return so;
    return (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '');
  });
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeDose(name, time, status) {
  return {
    key: `${name}|${time}`,
    scheduledAt: time ? `2024-01-01T${time}:00` : null,
    medication: { name },
    status,
  };
}

// ─── Test 1: same scheduled time, two meds ────────────────────────────────────

console.log('\nTest 1: same scheduled time — Aspirin and Zoloft both at 08:00');

const t1_initial = [makeDose('Aspirin', '08:00', 'due'), makeDose('Zoloft', '08:00', 'due')];
const t1_statusSorted = statusSort(t1_initial); // getDosesForDate output (same status → sort by time → same → original order)

// After taking Aspirin, getDosesForDate returns Zoloft(due) first, Aspirin(taken) second
const t1_afterTake = statusSort([makeDose('Aspirin', '08:00', 'taken'), makeDose('Zoloft', '08:00', 'due')]);

console.log(' [broken]');
const b1_before = sortBroken(t1_statusSorted).map(d => d.medication.name);
const b1_after  = sortBroken(t1_afterTake).map(d => d.medication.name);
assert(b1_before[0] === 'Aspirin', `before: Aspirin first (got ${b1_before[0]})`);
assert(b1_after[0]  === 'Aspirin', `after take: Aspirin still first (got ${b1_after[0]})`);

console.log(' [fixed]');
const f1_before = sortFixed(t1_statusSorted).map(d => d.medication.name);
const f1_after  = sortFixed(t1_afterTake).map(d => d.medication.name);
assert(f1_before[0] === 'Aspirin', `before: Aspirin first (got ${f1_before[0]})`);
assert(f1_after[0]  === 'Aspirin', `after take: Aspirin still first (got ${f1_after[0]})`);

// ─── Test 2: different scheduled times ───────────────────────────────────────

console.log('\nTest 2: different times — Aspirin 08:00, Zoloft 12:00');

const t2_initial  = statusSort([makeDose('Aspirin', '08:00', 'due'), makeDose('Zoloft', '12:00', 'due')]);
const t2_afterTake = statusSort([makeDose('Aspirin', '08:00', 'taken'), makeDose('Zoloft', '12:00', 'due')]);

console.log(' [broken]');
const b2_before = sortBroken(t2_initial).map(d => d.medication.name);
const b2_after  = sortBroken(t2_afterTake).map(d => d.medication.name);
assert(b2_before[0] === 'Aspirin', `before: Aspirin first (got ${b2_before[0]})`);
assert(b2_after[0]  === 'Aspirin', `after take: Aspirin still first (got ${b2_after[0]})`);

console.log(' [fixed]');
const f2_before = sortFixed(t2_initial).map(d => d.medication.name);
const f2_after  = sortFixed(t2_afterTake).map(d => d.medication.name);
assert(f2_before[0] === 'Aspirin', `before: Aspirin first (got ${f2_before[0]})`);
assert(f2_after[0]  === 'Aspirin', `after take: Aspirin still first (got ${f2_after[0]})`);

// ─── Test 3: three meds, middle one taken ────────────────────────────────────

console.log('\nTest 3: three meds at same time — Alpha, Beta, Gamma; take Beta');

const t3_initial   = statusSort([makeDose('Alpha', '08:00', 'due'), makeDose('Beta', '08:00', 'due'), makeDose('Gamma', '08:00', 'due')]);
const t3_afterTake = statusSort([makeDose('Alpha', '08:00', 'due'), makeDose('Beta', '08:00', 'taken'), makeDose('Gamma', '08:00', 'due')]);

console.log(' [broken]');
const b3_before = sortBroken(t3_initial).map(d => d.medication.name);
const b3_after  = sortBroken(t3_afterTake).map(d => d.medication.name);
assert(JSON.stringify(b3_before) === JSON.stringify(['Alpha','Beta','Gamma']), `before: Alpha,Beta,Gamma (got ${b3_before})`);
assert(JSON.stringify(b3_after)  === JSON.stringify(['Alpha','Beta','Gamma']), `after take Beta: Alpha,Beta,Gamma (got ${b3_after})`);

console.log(' [fixed]');
const f3_before = sortFixed(t3_initial).map(d => d.medication.name);
const f3_after  = sortFixed(t3_afterTake).map(d => d.medication.name);
assert(JSON.stringify(f3_before) === JSON.stringify(['Alpha','Beta','Gamma']), `before: Alpha,Beta,Gamma (got ${f3_before})`);
assert(JSON.stringify(f3_after)  === JSON.stringify(['Alpha','Beta','Gamma']), `after take Beta: Alpha,Beta,Gamma (got ${f3_after})`);

// ─── PRN (no scheduled time) ──────────────────────────────────────────────────

console.log('\nTest 4: PRN dose (no scheduledAt) sorts after timed doses');

const t4 = [makeDose('PRN Med', null, 'upcoming'), makeDose('Aspirin', '08:00', 'due')];
const f4 = sortFixed(statusSort(t4)).map(d => d.medication.name);
assert(f4[0] === 'Aspirin', `Aspirin (timed) before PRN Med (got ${f4[0]})`);
assert(f4[1] === 'PRN Med',  `PRN Med last (got ${f4[1]})`);

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
