// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const E = require('../js/engine.js');
const { createStore } = require('../js/store.js');
const Seed = require('../js/seed.js');

const base = { life_threat: false, in_progress: false, weapons_involved: false, active_violence: false,
  suspect_on_scene_or_fleeing: false, vulnerable_party: false, fire_or_hazmat: false, minutes_since_event: null };
const P = (over, n = 1) => E.computePriority({ ...base, ...over }, n);

test('override 1: life threat + in progress → P0', () => {
  assert.equal(P({ life_threat: true, in_progress: true }).priority, 0);
});
test('override 2: weapon / violence / fire → P1', () => {
  assert.equal(P({ weapons_involved: true }).priority, 1);
  assert.equal(P({ active_violence: true }).priority, 1);
  assert.equal(P({ fire_or_hazmat: true }).priority, 1);
});
test('override 2 does not lower a P0', () => {
  assert.equal(P({ life_threat: true, in_progress: true, weapons_involved: true }).priority, 0);
});
test('override 3: in progress + suspect → at least P2', () => {
  assert.equal(P({ in_progress: true, suspect_on_scene_or_fleeing: true }).priority, 2);
});
test('override 4: >240 min old, no life threat → P4', () => {
  assert.equal(P({ minutes_since_event: 1440 }).priority, 4);
  assert.notEqual(P({ minutes_since_event: 1440, life_threat: true }).priority, 4);
});
test('score mapping', () => {
  assert.equal(E.scoreToPriority(80), 1);
  assert.equal(E.scoreToPriority(55), 2);
  assert.equal(E.scoreToPriority(25), 3);
  assert.equal(E.scoreToPriority(24), 4);
  assert.equal(P({ in_progress: true, vulnerable_party: true }, 5).priority, 3); // 20+10+5
});
test('every result has at least one reason', () => {
  for (const o of [{}, { life_threat: true, in_progress: true }, { weapons_involved: true }, { minutes_since_event: 600 }])
    assert.ok(P(o).reasons.length > 0);
});
test('reasons cite the caller', () => {
  const r = E.computePriority({ ...base, weapons_involved: true }, 3, { weapons_involved: { n: 3, detail: 'gun seen' } });
  assert.match(r.reasons[0], /caller #3/);
});
test('extraction: unknown text is unclassified + needs review', () => {
  const x = E.extract('uh hello? hello?');
  assert.equal(x.category, 'unclassified');
  assert.equal(x.needs_review, true);
});
test('extraction: "shots fired" is not a fire', () => {
  assert.equal(E.extract('shots fired near the park').fire_or_hazmat, false);
});
test('deflection never applies to protected factors', () => {
  assert.equal(E.canDeflect({ ...base, weapons_involved: true }, 3), false);
  assert.equal(E.canDeflect({ ...base, vulnerable_party: true }, 4), false);
  assert.equal(E.canDeflect(base, 4), true);
  assert.equal(E.canDeflect(base, 2), false);
});

test('surge replay: acceptance criteria', () => {
  const st = createStore(Seed);
  const T0 = Date.now();
  st.loadSeed(T0);
  for (const c of Seed.calls) st.addCall(c, T0 + c.t * 1000);
  st.runRootCause(T0 + 120000);
  const s = st.stats(T0 + 120000);
  assert.ok(s.calls >= 190 && s.reduction > 60, `reduction ${s.reduction}%`);
  const bqe = st.S.incidents.find((i) => i.category === 'traffic crash' && i.call_count === 25);
  assert.equal(bqe.priority, 0);
  const h = st.S.history.filter((x) => x.incident_id === bqe.id).map((x) => x.old_priority + '>' + x.new_priority);
  assert.deepEqual(h, ['2>1', '1>0']);
  assert.match(bqe.priority_reasons[0], /caller #14/);
  assert.ok(st.S.clusters.some((c) => c.label === 'Possible water main break' && c.incident_ids.length >= 4));
  const shots = st.S.incidents.find((i) => i.category === 'shots fired');
  assert.ok(st.S.suggestions.some((x) => x.to_incident_id === shots.id && x.unit_id === 'U4'));
  assert.ok(st.S.incidents.some((i) => i.pending_downgrade), 'fire downgrade awaits dispatcher');
  for (const i of st.S.incidents) assert.ok(i.priority_reasons.length > 0);
});
