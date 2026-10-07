// In-memory store + pipeline (extract → dedupe → score → save). Stands in for the
// database and API server. No DOM here so it can be exercised from Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.Store = factory(root.Engine);
})(typeof self !== 'undefined' ? self : this, function (Engine) {
  function createStore(seed, emit = () => {}) {
    const S = {
      calls: [], incidents: [], history: [], clusters: [], units: [], suggestions: [],
      stats: { deflected: 0, deflectable: 0, textSubscribers: 0 },
      dismissedClusterKeys: new Set(),
    };
    let seq = { call: 0, inc: 0, hist: 0, cl: 0, sug: 0 };
    const byId = (arr, id) => arr.find((x) => x.id === id);

    // ------------------------------------------------------------ helpers
    function newIncident(call, ex, now) {
      const inc = {
        id: 'I' + String(++seq.inc).padStart(3, '0'),
        created_at: now, updated_at: now, category: ex.category, lat: call.lat, lng: call.lng, address: call.address,
        priority: 4, priority_reasons: [], call_count: 0, status: 'open', root_cause_cluster_id: null,
        factors: { life_threat: false, in_progress: false, weapons_involved: false, active_violence: false,
          suspect_on_scene_or_fleeing: false, vulnerable_party: false, fire_or_hazmat: false, minutes_since_event: null },
        sources: {}, key_details: [], call_ids: [], texts: [], needs_review: false, pending_downgrade: null,
        flash_until: 0, assigned_unit_id: null, from_session: true,
      };
      S.incidents.push(inc);
      return inc;
    }

    function mergeInto(inc, call, ex) {
      const n = inc.call_count + 1;
      const added = [];
      for (const k of Engine.BOOL_FACTORS) {
        if (ex[k] && !inc.factors[k]) {
          inc.factors[k] = true;
          inc.sources[k] = { n, detail: pickDetail(k, ex), callId: call.id };
          added.push(k);
        }
      }
      if (ex.minutes_since_event !== null) {
        inc.factors.minutes_since_event = inc.factors.minutes_since_event === null
          ? ex.minutes_since_event : Math.min(inc.factors.minutes_since_event, ex.minutes_since_event);
      }
      // A fresh "happening now" call clears an old "hours ago" timestamp.
      if (ex.in_progress && ex.minutes_since_event === null && inc.factors.minutes_since_event > 240) inc.factors.minutes_since_event = null;
      for (const d of ex.key_details) if (!inc.key_details.includes(d)) inc.key_details.push(d);
      inc.lat = (inc.lat * inc.call_count + call.lat) / n;
      inc.lng = (inc.lng * inc.call_count + call.lng) / n;
      inc.call_count = n;
      inc.call_ids.push(call.id);
      inc.texts.push(call.raw_text);
      inc.updated_at = call.created_at;
      if (ex.needs_review) inc.needs_review = true;
      call.caller_no = n;
      return added;
    }

    function pickDetail(k, ex) {
      const prefs = {
        life_threat: ['person trapped', 'person shot', 'bleeding', 'not breathing', 'unconscious'],
        fire_or_hazmat: ['vehicle on fire', 'flames visible', 'smoke visible'],
        weapons_involved: ['gun seen', 'knife involved', 'gunshots heard'],
        suspect_on_scene_or_fleeing: ['suspect/driver fleeing'],
        vulnerable_party: ['child involved', 'elderly person'],
      }[k] || [];
      return prefs.find((p) => ex.key_details.includes(p)) || ex.key_details[0] || '';
    }

    function rescore(inc, call, added, now) {
      const r = Engine.computePriority(inc.factors, inc.call_count, inc.sources);
      const old = inc.priority;
      if (inc.call_count === 1) {
        inc.priority = r.priority; inc.priority_reasons = r.reasons;
        return { changed: false };
      }
      if (r.priority < old) {
        inc.priority = r.priority; inc.priority_reasons = r.reasons;
        const why = added.length
          ? added.map((k) => `${Engine.FACTOR_LABEL[k]} reported by caller #${inc.sources[k].n}${inc.sources[k].detail ? ` ("${inc.sources[k].detail}")` : ''}`).join('; ')
          : `Corroboration from ${inc.call_count} callers`;
        S.history.push({ id: ++seq.hist, incident_id: inc.id, old_priority: old, new_priority: r.priority, reason: why, triggered_by_call_id: call.id, created_at: now, kind: 'upgrade' });
        inc.flash_until = now + 10000;
        emit('upgrade', { incident: inc, from: old, to: r.priority, reason: why });
        return { changed: true, upgraded: true };
      }
      if (r.priority === old) inc.priority_reasons = r.reasons; // refresh citations/score
      // Never auto-downgrade: lower merged priority is ignored here.
      return { changed: false };
    }

    function checkDowngrade(inc, call, ex, now) {
      if (!ex.resolution_signal) return;
      const f = { ...inc.factors };
      if (!ex.fire_or_hazmat) f.fire_or_hazmat = false;
      if (!ex.life_threat) f.life_threat = false;
      if (!ex.in_progress) f.in_progress = false;
      const r = Engine.computePriority(f, inc.call_count, {});
      if (r.priority > inc.priority) {
        inc.pending_downgrade = {
          to: r.priority, factors: f, reasons: r.reasons, call_id: call.id,
          reason: `Caller #${call.caller_no} reports: "${call.raw_text}"`, created_at: now,
        };
        emit('downgrade_suggested', { incident: inc });
      }
    }

    function suggestPreemption(inc, now) {
      if (inc.priority > 1 || inc.assigned_unit_id) return;
      if (S.suggestions.some((s) => s.to_incident_id === inc.id && s.status === 'pending')) return;
      let best = null;
      for (const u of S.units) {
        if (!u.assigned_incident_id) continue;
        const from = byId(S.incidents, u.assigned_incident_id);
        if (!from || from.priority < 3) continue;
        const d = Engine.distanceMeters(u.lat, u.lng, inc.lat, inc.lng);
        if (d <= 2000 && (!best || d < best.d)) best = { u, from, d };
      }
      if (!best) return;
      const sug = { id: ++seq.sug, unit_id: best.u.id, from_incident_id: best.from.id, to_incident_id: inc.id, distance_m: Math.round(best.d), status: 'pending', created_at: now };
      S.suggestions.push(sug);
      emit('preemption', sug);
    }

    // ------------------------------------------------------------ public API
    /** Find the incident a draft call would be merged into (used for caller deflection). */
    function preview(input, now = Date.now()) {
      const ex = Engine.extract(input.raw_text);
      const solo = Engine.computePriority(ex, 1, {});
      const draft = { ...input, category: ex.category };
      const match = Engine.findDuplicate(draft, S.incidents, now);
      return { ex, priority: solo.priority, reasons: solo.reasons, match: match && match.incident, deflectable: !!match && Engine.canDeflect(ex, solo.priority) };
    }

    /** POST /calls equivalent. */
    function addCall(input, now = Date.now()) {
      const ex = Engine.extract(input.raw_text);
      const call = {
        id: 'C' + String(++seq.call).padStart(4, '0'), created_at: now, channel: input.channel || 'phone',
        raw_text: input.raw_text, lat: input.lat, lng: input.lng, address: input.address || '',
        category: ex.category, extracted_factors: ex, incident_id: null, is_duplicate: false, caller_no: 1,
        needs_review: ex.needs_review,
      };
      S.calls.push(call);
      const solo = Engine.computePriority(ex, 1, {});
      const match = input.force_incident_id ? { incident: byId(S.incidents, input.force_incident_id) } : Engine.findDuplicate(call, S.incidents, now);
      let inc, created = false;
      if (match && match.incident) {
        inc = match.incident;
        call.is_duplicate = true;
        if (Engine.canDeflect(ex, solo.priority)) S.stats.deflectable++;
        if (inc.status === 'resolved') inc.status = 'reopened';
      } else {
        inc = newIncident(call, ex, now);
        created = true;
      }
      call.incident_id = inc.id;
      const added = mergeInto(inc, call, ex);
      const res = rescore(inc, call, added, now);
      if (!created) checkDowngrade(inc, call, ex, now);
      if (created || res.upgraded) suggestPreemption(inc, now);
      emit('call', { call, incident: inc, created });
      return { call, incident: inc, created, upgraded: !!res.upgraded };
    }

    function runRootCause(now = Date.now()) {
      const found = Engine.findRootCauseClusters(S.incidents, now);
      const out = [];
      for (const c of found) {
        if (S.dismissedClusterKeys.has(c.key)) continue;
        const existing = S.clusters.find((x) => x.label === c.label && x.status !== 'dismissed' && x.incident_ids.some((id) => c.incident_ids.includes(id)));
        if (existing) {
          if (existing.status === 'suggested') Object.assign(existing, { ...c, id: existing.id, status: existing.status, created_at: existing.created_at });
          continue;
        }
        const cl = { ...c, id: 'RC' + ++seq.cl, created_at: now, status: 'suggested' };
        S.clusters.push(cl);
        out.push(cl);
        emit('cluster', cl);
      }
      return out;
    }

    function confirmCluster(id) {
      const cl = byId(S.clusters, id); if (!cl) return;
      cl.status = 'confirmed';
      for (const iid of cl.incident_ids) { const i = byId(S.incidents, iid); if (i) i.root_cause_cluster_id = cl.id; }
      emit('change');
    }
    function dismissCluster(id) {
      const cl = byId(S.clusters, id); if (!cl) return;
      cl.status = 'dismissed'; S.dismissedClusterKeys.add(cl.key); emit('change');
    }

    function acceptDowngrade(incId, now = Date.now()) {
      const inc = byId(S.incidents, incId); if (!inc || !inc.pending_downgrade) return;
      const pd = inc.pending_downgrade;
      S.history.push({ id: ++seq.hist, incident_id: inc.id, old_priority: inc.priority, new_priority: pd.to, reason: `Downgrade accepted by dispatcher. ${pd.reason}`, triggered_by_call_id: pd.call_id, created_at: now, kind: 'downgrade' });
      inc.factors = pd.factors;
      inc.priority = pd.to;
      inc.priority_reasons = [...pd.reasons, 'Downgrade approved by dispatcher'];
      inc.pending_downgrade = null;
      emit('change');
    }
    function rejectDowngrade(incId) { const inc = byId(S.incidents, incId); if (inc) { inc.pending_downgrade = null; emit('change'); } }

    function setPriority(incId, p, now = Date.now()) {
      const inc = byId(S.incidents, incId); if (!inc || inc.priority === p) return;
      S.history.push({ id: ++seq.hist, incident_id: inc.id, old_priority: inc.priority, new_priority: p, reason: 'Manual override by dispatcher', triggered_by_call_id: null, created_at: now, kind: 'manual' });
      inc.priority = p;
      inc.priority_reasons = [`Dispatcher set P${p} manually`, ...inc.priority_reasons.filter((r) => !r.startsWith('Dispatcher set'))];
      emit('change');
    }

    function setStatus(incId, status) {
      const inc = byId(S.incidents, incId); if (!inc) return;
      inc.status = status;
      if (status === 'resolved' && inc.assigned_unit_id) {
        const u = byId(S.units, inc.assigned_unit_id);
        if (u) { u.status = 'available'; u.assigned_incident_id = null; }
        inc.assigned_unit_id = null;
      }
      emit('change');
    }

    function assignUnit(unitId, incId) {
      const u = byId(S.units, unitId), inc = byId(S.incidents, incId); if (!u || !inc) return;
      if (u.assigned_incident_id) {
        const prev = byId(S.incidents, u.assigned_incident_id);
        if (prev) { prev.assigned_unit_id = null; if (prev.status === 'dispatched') prev.status = 'open'; }
      }
      u.assigned_incident_id = inc.id; u.status = 'en_route';
      inc.assigned_unit_id = u.id; inc.status = 'dispatched';
      emit('change');
    }

    function dispatchNearest(incId) {
      const inc = byId(S.incidents, incId); if (!inc) return null;
      const free = S.units.filter((u) => u.status === 'available')
        .map((u) => ({ u, d: Engine.distanceMeters(u.lat, u.lng, inc.lat, inc.lng) })).sort((a, b) => a.d - b.d)[0];
      if (!free) return null;
      assignUnit(free.u.id, incId);
      return free;
    }

    function resolveSuggestion(id, accept) {
      const s = S.suggestions.find((x) => x.id === id); if (!s) return;
      s.status = accept ? 'accepted' : 'ignored';
      if (accept) assignUnit(s.unit_id, s.to_incident_id); else emit('change');
    }

    // ------------------------------------------------------------ seed
    function loadSeed(now = Date.now()) {
      for (const p of seed.preIncidents) {
        const t = now - p.minutesAgo * 60000;
        let inc;
        for (let i = 0; i < p.calls; i++) {
          const r = addCall({ raw_text: p.raw_text, lat: p.lat, lng: p.lng, address: p.address, channel: 'phone', force_incident_id: inc && inc.id }, t + i * 60000);
          inc = r.incident;
          r.call.preexisting = true;
        }
        inc.from_session = false;
        inc.created_at = t;
        p.id = inc.id;
      }
      S.stats.deflectable = 0;
      for (const u of seed.units) {
        const pre = seed.preIncidents.find((p) => p.key === u.assigned_incident_key);
        const unit = { id: u.id, name: u.name, lat: u.lat, lng: u.lng, status: u.status, assigned_incident_id: pre ? pre.id : null };
        S.units.push(unit);
        if (pre) { const inc = byId(S.incidents, pre.id); inc.assigned_unit_id = unit.id; inc.status = 'dispatched'; }
      }
    }

    function stats(now = Date.now()) {
      const sessionCalls = S.calls.filter((c) => !c.preexisting);
      const sessionIncidents = S.incidents.filter((i) => i.from_session);
      const dups = sessionCalls.filter((c) => c.is_duplicate).length;
      return {
        calls: sessionCalls.length,
        incidents: sessionIncidents.length,
        duplicates: dups,
        reduction: sessionCalls.length ? Math.round((1 - sessionIncidents.length / sessionCalls.length) * 100) : 0,
        critical: S.incidents.filter((i) => i.priority <= 1 && i.status !== 'resolved').length,
        upgrades10: S.history.filter((h) => h.kind === 'upgrade' && now - h.created_at <= 600000).length,
        deflectable: S.stats.deflectable,
        deflected: S.stats.deflected,
      };
    }

    return {
      S, addCall, preview, runRootCause, confirmCluster, dismissCluster, acceptDowngrade, rejectDowngrade,
      setPriority, setStatus, assignUnit, dispatchNearest, resolveSuggestion, loadSeed, stats, byId,
    };
  }
  return { createStore };
});
