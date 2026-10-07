// SurgeTriage engine: extraction, priority scoring, dedupe, clustering helpers.
// Pure functions only — no DOM, no state. Works in the browser (window.Engine) and in Node (require).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // ---------------------------------------------------------------- categories
  // Order matters: first match wins.
  const CATEGORY_RULES = [
    ['shots fired', /\b(shots?|gunshots?|gunfire|shooting|shooter)\b/],
    ['traffic crash', /\b(crash|collision|pile-?up|car accident|accident on|wreck|rear-?ended|hit by a car)\b/],
    ['gas smell', /(smell(s|ing)? (of |like )?gas|gas (leak|smell))/],
    ['explosion sound', /(explosion|loud boom|\bblast\b)/],
    ['people trapped', /(trapped|stuck under debris)/],
    ['structural crack', /(crack(s|ed)? in (the )?(wall|building|facade|foundation)|building (is )?(leaning|cracking))/],
    ['debris falling', /(debris|bricks?) (is |are )?(falling|fell|coming down)/],
    ['fire', /(\bfire\b|smoke|flames|burning)/],
    ['sinkhole', /(sink ?hole|road (is )?caving|asphalt (is )?caving|cave-?in)/],
    ['flooding', /(flood|gushing|water (is )?(pouring|rushing|bubbling|shooting) (up|out|into))/],
    ['low water pressure', /(pressure|trickle)/],
    ['no water', /(no water|water is off|taps? (are|is) dry|no running water|water (got )?shut off|dry faucets?)/],
    ['no power', /(no power|power (is )?out|blackout|lost power|electricity (is )?out)/],
    ['traffic signal out', /(traffic (light|signal)s? (is |are )?(out|dark|not working))/],
    ['elevator stuck', /(stuck in (the|an) elevator|elevator (is )?stuck)/],
    ['headaches/dizziness', /(headache|dizzy|dizziness|nause)/],
    ['welfare check', /(crying for help|in distress|welfare check)/],
  ['assault', /(fight|fighting|beating|attack|assault|punch|stabb|knife)/],
    ['medical', /(not breathing|unconscious|fell|chest pain|heart attack|overdose|seizure|collapsed|bleeding)/],
    ['noise', /(loud|noise|music|blasting|party|barking|jackhammer|bass)/],
    ['illegal parking', /(parked|parking|driveway|double.?park|bike lane)/],
    ['theft', /(stolen|stole|broke into|break-?in|burglar|took my|missing package|robbed)/],
    ['inquiry', /(question|how do i|information about|what are the hours|tax bill|permit)/],
  ];

  // ---------------------------------------------------------------- dedupe windows
  const UTILITY = ['no water', 'low water pressure', 'flooding', 'sinkhole', 'no power', 'traffic signal out', 'gas smell'];
  function dedupeWindow(category) {
    if (category === 'traffic crash') return { meters: 150, minutes: 30 };
    if (category === 'shots fired') return { meters: 500, minutes: 20 };
    if (category === 'fire') return { meters: 300, minutes: 60 };
    if (category === 'noise') return { meters: 100, minutes: 180 };
    if (UTILITY.includes(category)) return { meters: 400, minutes: 720 };
    return { meters: 200, minutes: 120 };
  }

  // ---------------------------------------------------------------- root-cause patterns
  const ROOT_CAUSE_PATTERNS = [
    { label: 'Possible water main break', categories: ['no water', 'low water pressure', 'flooding', 'sinkhole'] },
    { label: 'Possible power outage', categories: ['no power', 'traffic signal out', 'elevator stuck'] },
    { label: 'Possible gas leak', categories: ['gas smell', 'explosion sound', 'headaches/dizziness'] },
    { label: 'Possible building collapse', categories: ['structural crack', 'debris falling', 'people trapped'] },
  ];

  // ---------------------------------------------------------------- key details
  const KEY_PHRASES = [
    [/(car|vehicle|suv|truck).{0,25}(on fire|burning|in flames)|(on fire|burning).{0,15}(car|vehicle)/, 'vehicle on fire'],
    [/(trapped|pinned)/, 'person trapped'],
    [/(got shot|been shot|was shot|is shot|shot in the)/, 'person shot'],
    [/(gunshots|shots fired|heard shots|\bshots\b)/, 'gunshots heard'],
    [/bleeding/, 'bleeding'],
    [/not breathing/, 'not breathing'],
    [/unconscious/, 'unconscious'],
    [/knife|stabb/, 'knife involved'],
    [/\bgun\b|pistol|rifle/, 'gun seen'],
    [/(drive off|drove off|ran (off|away|toward)|fled|took off|running (away|toward)|trying to leave)/, 'suspect/driver fleeing'],
    [/(\d+|two|three|four|five|several|multiple) cars/, 'multiple vehicles'],
    [/smoke/, 'smoke visible'],
    [/flames/, 'flames visible'],
    [/(child|kid|baby|toddler)/, 'child involved'],
    [/(elderly|old (man|woman|lady)|grandm|grandf|senior)/, 'elderly person'],
    [/(no water|taps? (are|is) dry|dry faucet)/, 'no water'],
    [/(pressure|trickle)/, 'low water pressure'],
    [/(flood|gushing)/, 'street flooding'],
    [/(sink ?hole|caving)/, 'sinkhole'],
    [/(music|party|bass)/, 'loud music'],
    [/driveway/, 'driveway blocked'],
    [/(stolen|stole|took my)/, 'property stolen'],
    [/(fire is out|fire'?s out|put (it|the fire) out)/, 'fire is out'],
    [/(everyone is (safe|ok|okay|fine)|no one (is )?(hurt|injured))/, 'no injuries'],
  ];

  const NEG_LIFE = /(no one (is |was )?(hurt|injured)|nobody (is |was )?(hurt|injured)|everyone is (safe|ok|okay|fine)|everybody'?s? (safe|ok|okay|fine))/;
  const NEG_FIRE = /(fire is out|fire'?s out|fire (has been|was) put out|put (it|the fire) out|no more smoke)/;
  const RESOLUTION = /(fire is out|fire'?s out|put (it|the fire) out|everyone is (safe|ok|okay|fine)|all clear|false alarm|no longer|has left|is gone now|they left|it stopped)/;

  function parseMinutesSince(t) {
    let m;
    if ((m = t.match(/(\d+)\s*(minute|min)s?\s*ago/))) return +m[1];
    if ((m = t.match(/(\d+)\s*(hour|hr)s?\s*ago/))) return +m[1] * 60;
    if ((m = t.match(/(\d+)\s*days?\s*ago/))) return +m[1] * 1440;
    if (/(a couple|two|few) days ago/.test(t)) return 2 * 1440;
    if (/last week/.test(t)) return 7 * 1440;
    if (/yesterday/.test(t)) return 1440;
    if (/last night|overnight/.test(t)) return 600;
    if (/this morning|earlier today/.test(t)) return 300;
    if (/(just now|just happened|right now|happening now)/.test(t)) return 0;
    return null;
  }

  /**
   * Stand-in for the LLM extraction step. Returns the same strict JSON shape the
   * spec asks Claude to produce. If nothing recognisable is found the category is
   * "unclassified" and needs_review is set, instead of guessing.
   */
  function extract(rawText) {
    const t = String(rawText || '').toLowerCase();
    let category = 'unclassified';
    for (const [name, re] of CATEGORY_RULES) if (re.test(t)) { category = name; break; }

    const minutes = parseMinutesSince(t);
    const past = minutes !== null && minutes > 30;
    const resolved = RESOLUTION.test(t);

    let life = /(not breathing|unconscious|bleeding|trapped|pinned|been shot|got shot|was shot|is shot|stabbed|dying|heart attack|can'?t breathe|overdose|seriously (hurt|injured)|badly (hurt|injured))/.test(t);
    if (NEG_LIFE.test(t)) life = false;
    let fire = /(\bon fire\b|flames|\bfire\b|smoke|burning|gas leak|smell(s|ing)? (of |like )?gas|chemical|hazmat|explosion)/.test(t);
    if (NEG_FIRE.test(t)) fire = false;

    const factors = {
      category,
      life_threat: life,
      in_progress: !past && !resolved,
      minutes_since_event: minutes,
      weapons_involved: /(\bgun\b|knife|weapon|armed|pistol|rifle|machete|gunshots?|shots fired|\bshots\b|gunfire|shooter)/.test(t),
      active_violence: /(fighting|beating|attacking|assaulting|punching|shooting at|stabbing|hitting (him|her|them))/.test(t),
      suspect_on_scene_or_fleeing: /(fled|fleeing|running away|running toward|ran (off|away|toward)|took off|drove off|drive off|trying to (leave|drive off|flee|run)|still (here|outside|on scene)|getaway)/.test(t),
      vulnerable_party: /(child|kid|baby|toddler|elderly|old (man|woman|lady)|grandm|grandf|senior|disabled|wheelchair|pregnant|crying for help|in distress)/.test(t),
      fire_or_hazmat: fire,
      key_details: KEY_PHRASES.filter(([re]) => re.test(t)).map(([, label]) => label),
    };
    if (!factors.key_details.length) factors.key_details = [t.split(/\s+/).slice(0, 6).join(' ')];
    return { ...factors, resolution_signal: resolved, needs_review: category === 'unclassified' };
  }

  // ---------------------------------------------------------------- priority engine
  const BOOL_FACTORS = ['life_threat', 'in_progress', 'weapons_involved', 'active_violence', 'suspect_on_scene_or_fleeing', 'vulnerable_party', 'fire_or_hazmat'];
  const FACTOR_LABEL = {
    life_threat: 'Life threat',
    in_progress: 'In progress',
    weapons_involved: 'Weapon',
    active_violence: 'Active violence',
    suspect_on_scene_or_fleeing: 'Suspect on scene/fleeing',
    vulnerable_party: 'Vulnerable party',
    fire_or_hazmat: 'Fire/hazmat',
  };

  function scoreToPriority(score) {
    if (score >= 80) return 1;
    if (score >= 55) return 2;
    if (score >= 25) return 3;
    return 4;
  }

  /**
   * Deterministic, explainable priority. The LLM never assigns priority.
   * @param f       merged factors (booleans + minutes_since_event)
   * @param callCount number of independent callers
   * @param sources optional { factor: { n, detail } } — which caller first reported each factor
   * @returns { priority, score, reasons: string[] }
   */
  function computePriority(f, callCount = 1, sources = {}) {
    const cite = (k) => (sources[k] ? ` (caller #${sources[k].n}${sources[k].detail ? `: "${sources[k].detail}"` : ''})` : '');
    const reasons = [];

    // Score is always computed so the reasons can show it.
    let score = 0;
    const parts = [];
    if (f.life_threat) { score += 40; parts.push(`+40 life threat${cite('life_threat')}`); }
    if (f.in_progress) { score += 20; parts.push('+20 happening now'); }
    if (f.weapons_involved || f.active_violence) { score += 15; parts.push(`+15 weapon/violence${cite(f.weapons_involved ? 'weapons_involved' : 'active_violence')}`); }
    if (f.suspect_on_scene_or_fleeing) { score += 10; parts.push(`+10 suspect on scene or fleeing${cite('suspect_on_scene_or_fleeing')}`); }
    if (f.vulnerable_party) { score += 10; parts.push(`+10 vulnerable party${cite('vulnerable_party')}`); }
    const corroboration = Math.min(5, Math.max(1, callCount));
    score += corroboration;
    parts.push(`+${corroboration} corroboration (${callCount} independent caller${callCount === 1 ? '' : 's'})`);
    const scored = scoreToPriority(score);

    // Hard overrides, in order.
    if (f.life_threat && f.in_progress) {
      reasons.push(`P0 override: life-threatening and happening now${cite('life_threat')}`);
      reasons.push(`Score ${score}/100: ${parts.join(', ')}`);
      return { priority: 0, score, reasons };
    }
    let floor = null;
    if (f.weapons_involved) { floor = 1; reasons.push(`P1 override: weapon mentioned${cite('weapons_involved')}`); }
    if (f.active_violence) { floor = 1; reasons.push(`P1 override: active violence${cite('active_violence')}`); }
    if (f.fire_or_hazmat) { floor = 1; reasons.push(`P1 override: fire or hazmat${cite('fire_or_hazmat')}`); }
    if (f.in_progress && f.suspect_on_scene_or_fleeing) {
      if (floor === null || floor > 2) floor = 2;
      reasons.push(`At least P2: in progress with suspect on scene or fleeing${cite('suspect_on_scene_or_fleeing')}`);
    }
    if (floor !== null) {
      const p = Math.min(floor, scored);
      reasons.push(`Score ${score}/100 → P${scored}: ${parts.join(', ')}`);
      return { priority: p, score, reasons };
    }
    if (f.minutes_since_event !== null && f.minutes_since_event !== undefined && f.minutes_since_event > 240 && !f.life_threat) {
      const h = Math.round(f.minutes_since_event / 60);
      reasons.push(`P4 override: event was ~${h} h ago, no life threat (report only)`);
      return { priority: 4, score, reasons };
    }
    reasons.push(`Score ${score}/100 → P${scored}: ${parts.join(', ')}`);
    if (!f.in_progress && !f.life_threat) reasons.push('No present danger or injury reported');
    return { priority: scored, score, reasons };
  }

  // ---------------------------------------------------------------- geo + text similarity
  function distanceMeters(aLat, aLng, bLat, bLng) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // Same trigram construction as Postgres pg_trgm.
  function trigrams(s) {
    const set = new Set();
    for (const w of String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
      const p = `  ${w} `;
      for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3));
    }
    return set;
  }
  function similarity(a, b) {
    const A = trigrams(a), B = trigrams(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const g of A) if (B.has(g)) inter++;
    return inter / (A.size + B.size - inter);
  }

  /**
   * Find the open master incident a new call belongs to (nearest qualifying one).
   * incidents: [{ id, lat, lng, category, status, updated_at, texts: string[] }]
   */
  function findDuplicate(call, incidents, now = Date.now()) {
    const win = dedupeWindow(call.category);
    let best = null;
    for (const inc of incidents) {
      if (inc.status === 'resolved') continue;
      const d = distanceMeters(call.lat, call.lng, inc.lat, inc.lng);
      if (d > win.meters) continue;
      if (now - inc.updated_at > win.minutes * 60000) continue;
      const sim = Math.max(0, ...(inc.texts || []).map((t) => similarity(call.raw_text, t)));
      if (!(inc.category === call.category || sim > 0.3)) continue;
      if (!best || d < best.distance) best = { incident: inc, distance: d, similarity: sim };
    }
    return best;
  }

  /** Root-cause candidates: 3+ open incidents, different categories, within 500 m and 6 h, matching a pattern. */
  function findRootCauseClusters(incidents, now = Date.now()) {
    const open = incidents.filter((i) => i.status !== 'resolved' && now - i.created_at <= 6 * 3600000);
    const out = [];
    for (const pat of ROOT_CAUSE_PATTERNS) {
      const cand = open.filter((i) => pat.categories.includes(i.category));
      for (const seed of cand) {
        const group = cand.filter((i) => distanceMeters(seed.lat, seed.lng, i.lat, i.lng) <= 500);
        const cats = new Set(group.map((i) => i.category));
        if (cats.size < 3) continue;
        const ids = group.map((i) => i.id).sort();
        const key = pat.label + '|' + ids.join(',');
        if (out.some((c) => c.key === key)) continue;
        const lat = group.reduce((s, i) => s + i.lat, 0) / group.length;
        const lng = group.reduce((s, i) => s + i.lng, 0) / group.length;
        const radius = Math.max(150, ...group.map((i) => distanceMeters(lat, lng, i.lat, i.lng) + 80));
        const calls = group.reduce((s, i) => s + (i.call_count || 1), 0);
        const confidence = Math.min(0.97, 0.35 + 0.12 * cats.size + 0.015 * calls);
        out.push({ key, label: pat.label, lat, lng, radius_m: Math.round(radius), incident_ids: ids, categories: [...cats], confidence: +confidence.toFixed(2) });
      }
    }
    // Keep only the largest group per label.
    const byLabel = {};
    for (const c of out) if (!byLabel[c.label] || c.incident_ids.length > byLabel[c.label].incident_ids.length) byLabel[c.label] = c;
    return Object.values(byLabel);
  }

  /** Callers may be deflected only for non-emergency (P3/P4) reports without protected factors. */
  function canDeflect(factors, priority) {
    if (factors.life_threat || factors.weapons_involved || factors.fire_or_hazmat || factors.vulnerable_party) return false;
    return priority >= 3;
  }

  return {
    CATEGORY_RULES, ROOT_CAUSE_PATTERNS, BOOL_FACTORS, FACTOR_LABEL,
    extract, computePriority, scoreToPriority, dedupeWindow,
    distanceMeters, similarity, findDuplicate, findRootCauseClusters, canDeflect,
  };
});
