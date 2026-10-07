/* global Engine, Seed, Store, L */
(function () {
  const P_COLORS = ['#dc2626', '#f97316', '#fbbf24', '#3b82f6', '#94a3b8'];
  const P_BADGE = ['bg-red-600 text-white', 'bg-orange-500 text-white', 'bg-amber-400 text-slate-900', 'bg-blue-500 text-white', 'bg-slate-400 text-white'];
  const P_LABEL = ['Critical', 'Critical', 'Urgent', 'Routine', 'Report only'];
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const badge = (p, extra = '') => `<span class="inline-block px-1.5 py-0.5 rounded text-[11px] font-bold ${P_BADGE[p]} ${extra}">P${p}</span>`;
  const title = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function age(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
  }

  let store, selectedId = null;
  const map = L.map('map', { zoomControl: true }).setView([40.75, -73.94], 11);
  // CARTO serves OSM-based tiles without requiring a Referer header, so it works when opened from file://.
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, subdomains: 'abcd',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);
  // Recompute size once layout settles (flex containers can measure 0px tall at init).
  window.addEventListener('load', () => map.invalidateSize());
  window.addEventListener('resize', () => map.invalidateSize());
  setTimeout(() => map.invalidateSize(), 300);
  const layers = { inc: new Map(), units: new Map(), clusters: new Map(), lines: L.layerGroup().addTo(map) };

  // ------------------------------------------------------------ store setup
  function init() {
    for (const m of layers.inc.values()) m.remove();
    for (const m of layers.units.values()) m.remove();
    for (const m of layers.clusters.values()) m.remove();
    layers.inc.clear(); layers.units.clear(); layers.clusters.clear(); layers.lines.clearLayers();
    selectedId = null;
    store = Store.createStore(Seed, onEvent);
    store.loadSeed(Date.now());
    render();
  }

  function onEvent(type, p) {
    if (type === 'upgrade' && p.to <= 2) {
      toast(`<div class="font-bold">UPGRADED P${p.from} → P${p.to}</div><div>${esc(title(p.incident.category))} · ${p.incident.call_count} callers</div><div class="text-xs opacity-90 mt-0.5">${esc(p.reason)}</div>`, 'bg-red-600', p.incident.id);
    }
    if (type === 'downgrade_suggested') {
      toast(`<div class="font-bold">Downgrade suggested (needs approval)</div><div>${esc(title(p.incident.category))}: P${p.incident.priority} → P${p.incident.pending_downgrade.to}</div>`, 'bg-emerald-700', p.incident.id);
    }
    if (type === 'cluster') toast(`<div class="font-bold">Root cause detected</div><div>${esc(p.label)} (${p.incident_ids.length} incidents)</div>`, 'bg-purple-700');
    scheduleRender();
  }

  function toast(html, color, incId) {
    const el = document.createElement('div');
    el.className = `${color} text-white rounded-lg shadow-lg px-3 py-2 text-sm cursor-pointer`;
    el.innerHTML = html;
    el.onclick = () => { if (incId) select(incId); el.remove(); };
    $('#toasts').prepend(el);
    while ($('#toasts').children.length > 5) $('#toasts').lastChild.remove();
    setTimeout(() => el.remove(), 7000);
  }

  // ------------------------------------------------------------ rendering
  let raf = 0;
  function scheduleRender() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

  function render() {
    renderStats(); renderAlerts(); renderQueue(); renderMap(); renderDetail(); renderCallLog();
  }

  function renderStats() {
    const s = store.stats();
    const item = (label, val, cls = '') => `<div><div class="text-slate-400">${label}</div><div class="text-base font-bold ${cls}">${val}</div></div>`;
    $('#stats').innerHTML =
      item('Calls received', s.calls) +
      item('Unique incidents', s.incidents) +
      item('Duplicates merged', `${s.duplicates} <span class="text-emerald-400 text-xs">(−${s.reduction}%)</span>`) +
      item('Active P0/P1', s.critical, s.critical ? 'text-red-400' : '') +
      item('Upgrades (10 min)', s.upgrades10, s.upgrades10 ? 'text-orange-300' : '') +
      item('Repeat non-emergency', s.deflectable) +
      item('Callers deflected', s.deflected);
  }

  function renderAlerts() {
    const S = store.S;
    let html = '';
    for (const c of S.clusters.filter((c) => c.status === 'suggested')) {
      html += `<div class="bg-purple-50 border border-purple-300 text-purple-900 rounded px-3 py-1.5 flex items-center gap-3">
        <span class="font-semibold">◌ ${c.incident_ids.length} incidents may share one cause: ${esc(c.label)}.</span>
        <span class="text-xs">Complaint types: ${c.categories.map(esc).join(', ')} · within ${c.radius_m} m · confidence ${Math.round(c.confidence * 100)}%</span>
        <button class="ml-auto text-xs underline" data-act="zoom-cluster" data-id="${c.id}">Show</button>
        <button class="bg-purple-700 text-white text-xs px-2 py-0.5 rounded" data-act="confirm-cluster" data-id="${c.id}">Confirm &amp; link</button>
        <button class="text-xs px-2 py-0.5 rounded border border-purple-400" data-act="dismiss-cluster" data-id="${c.id}">Dismiss</button></div>`;
    }
    for (const s of S.suggestions.filter((s) => s.status === 'pending')) {
      const u = store.byId(S.units, s.unit_id), from = store.byId(S.incidents, s.from_incident_id), to = store.byId(S.incidents, s.to_incident_id);
      if (!u || !from || !to) continue;
      html += `<div class="bg-orange-50 border border-orange-300 text-orange-900 rounded px-3 py-1.5 flex items-center gap-3">
        <span>⇄ Suggest rerouting <b>${esc(u.name)}</b> from ${esc(title(from.category))} (P${from.priority}) to <b>${esc(title(to.category))} (P${to.priority})</b>, ${(s.distance_m / 1000).toFixed(1)} km away.</span>
        <button class="ml-auto text-xs underline" data-act="select" data-id="${to.id}">View</button>
        <button class="bg-orange-600 text-white text-xs px-2 py-0.5 rounded" data-act="reroute" data-id="${s.id}">Reroute</button>
        <button class="text-xs px-2 py-0.5 rounded border border-orange-400" data-act="ignore" data-id="${s.id}">Ignore</button></div>`;
    }
    $('#alerts').innerHTML = html;
    $('#alerts').classList.toggle('pt-2', !!html);
  }

  function sortedIncidents() {
    return store.S.incidents.filter((i) => i.status !== 'resolved').sort((a, b) => a.priority - b.priority || a.created_at - b.created_at);
  }

  function renderQueue() {
    const list = sortedIncidents();
    $('#queueCount').textContent = `${list.length} open`;
    const now = Date.now();
    $('#queue').innerHTML = list.map((i) => `
      <div data-act="select" data-id="${i.id}" class="cursor-pointer rounded border p-2 hover:bg-slate-50 ${i.id === selectedId ? 'border-slate-900 bg-slate-50' : 'border-slate-200'} ${i.flash_until > now ? 'flash' : ''}">
        <div class="flex items-center gap-2">
          ${badge(i.priority)}
          <span class="font-semibold truncate">${esc(title(i.category))}</span>
          ${i.pending_downgrade ? '<span class="text-[10px] bg-emerald-100 text-emerald-800 px-1 rounded">↓ pending</span>' : ''}
          ${i.needs_review ? '<span class="text-[10px] bg-yellow-100 text-yellow-800 px-1 rounded">review</span>' : ''}
          ${i.root_cause_cluster_id ? '<span class="text-[10px] bg-purple-100 text-purple-800 px-1 rounded">root cause</span>' : ''}
          <span class="ml-auto text-xs text-slate-500 whitespace-nowrap">📞 ${i.call_count} · ${age(i.created_at)}</span>
        </div>
        <div class="text-[11px] text-slate-500 truncate">${esc(i.address)} · ${i.status}${i.assigned_unit_id ? ' · ' + esc(i.assigned_unit_id) : ''}</div>
        <div class="text-xs text-slate-700 mt-0.5 line-clamp-2">${esc(i.priority_reasons[0] || '')}</div>
      </div>`).join('') || '<div class="text-slate-400 p-4 text-center">No open incidents. Click “Replay surge”.</div>';
  }

  function renderMap() {
    const S = store.S, now = Date.now();
    const seen = new Set();
    for (const i of S.incidents) {
      if (i.status === 'resolved') continue;
      seen.add(i.id);
      const radius = 5 + Math.sqrt(i.call_count) * 3;
      const style = { radius, color: i.id === selectedId || i.flash_until > now ? '#111827' : '#fff', weight: i.id === selectedId || i.flash_until > now ? 3 : 1.5, fillColor: P_COLORS[i.priority], fillOpacity: 0.85 };
      let m = layers.inc.get(i.id);
      if (!m) {
        m = L.circleMarker([i.lat, i.lng], style).addTo(map);
        m.on('click', () => select(i.id));
        layers.inc.set(i.id, m);
      }
      m.setLatLng([i.lat, i.lng]); m.setStyle(style); m.setRadius(radius);
      m.bindTooltip(`P${i.priority} ${esc(title(i.category))} · ${i.call_count} call(s)`);
    }
    for (const [id, m] of layers.inc) if (!seen.has(id)) { m.remove(); layers.inc.delete(id); }

    for (const c of S.clusters) {
      let m = layers.clusters.get(c.id);
      if (c.status === 'dismissed') { if (m) { m.remove(); layers.clusters.delete(c.id); } continue; }
      const style = { radius: c.radius_m, color: '#7c3aed', weight: 2, dashArray: '8 6', fill: true, fillOpacity: c.status === 'confirmed' ? 0.12 : 0.05 };
      if (!m) { m = L.circle([c.lat, c.lng], style).addTo(map); layers.clusters.set(c.id, m); }
      m.setLatLng([c.lat, c.lng]); m.setRadius(c.radius_m); m.setStyle(style);
      m.bindTooltip(`${esc(c.label)} (${c.status})`);
    }

    layers.lines.clearLayers();
    for (const u of S.units) {
      let m = layers.units.get(u.id);
      const icon = L.divIcon({ className: '', html: `<div class="unit-icon ${u.assigned_incident_id ? 'busy' : ''}" style="width:24px">${u.id}</div>`, iconSize: [24, 16] });
      if (!m) { m = L.marker([u.lat, u.lng], { icon }).addTo(map); layers.units.set(u.id, m); }
      m.setIcon(icon);
      const inc = u.assigned_incident_id && store.byId(S.incidents, u.assigned_incident_id);
      m.bindTooltip(`${u.name}: ${u.status.replace('_', ' ')}${inc ? ' → ' + title(inc.category) + ' (P' + inc.priority + ')' : ''}`);
      if (inc) L.polyline([[u.lat, u.lng], [inc.lat, inc.lng]], { color: '#7c3aed', weight: 2, dashArray: '2 6' }).addTo(layers.lines);
    }
  }

  function renderDetail() {
    const i = selectedId && store.byId(store.S.incidents, selectedId);
    if (!i) {
      $('#detail').innerHTML = `<div class="p-6 text-slate-400 text-center">Select an incident to see its calls, merged factors, priority reasons and history.</div>`;
      return;
    }
    const S = store.S;
    const calls = S.calls.filter((c) => c.incident_id === i.id);
    const hist = S.history.filter((h) => h.incident_id === i.id);
    const cl = S.clusters.find((c) => c.id === i.root_cause_cluster_id || (c.status === 'suggested' && c.incident_ids.includes(i.id)));
    const f = i.factors;
    const chip = (k) => `<span class="px-1.5 py-0.5 rounded text-[11px] ${f[k] ? 'bg-red-100 text-red-800 font-semibold' : 'bg-slate-100 text-slate-400'}">${f[k] ? '✓' : '✗'} ${Engine.FACTOR_LABEL[k]}${f[k] && i.sources[k] ? ` <span class="font-normal">#${i.sources[k].n}</span>` : ''}</span>`;
    const unit = i.assigned_unit_id && store.byId(S.units, i.assigned_unit_id);
    $('#detail').innerHTML = `
      <div class="p-3 border-b sticky top-0 bg-white z-10">
        <div class="flex items-center gap-2">${badge(i.priority, 'text-sm')}<span class="text-xs text-slate-500">${P_LABEL[i.priority]}</span>
          <span class="font-semibold text-base">${esc(title(i.category))}</span><span class="ml-auto text-xs text-slate-400">${i.id}</span></div>
        <div class="text-xs text-slate-500 mt-1">${esc(i.address)} · ${i.call_count} caller(s) · opened ${age(i.created_at)} ago · status <b>${i.status}</b>${unit ? ' · ' + esc(unit.name) + ' ' + unit.status.replace('_', ' ') : ''}</div>
        <div class="flex flex-wrap gap-1 mt-2">
          <button data-act="dispatch" data-id="${i.id}" class="text-xs bg-slate-900 text-white px-2 py-1 rounded">Dispatch nearest unit</button>
          <button data-act="resolve" data-id="${i.id}" class="text-xs border px-2 py-1 rounded">Mark resolved</button>
          <label class="text-xs border px-2 py-1 rounded">Set priority
            <select data-act="setp" data-id="${i.id}" class="ml-1">${[0, 1, 2, 3, 4].map((p) => `<option ${p === i.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        </div>
      </div>
      <div class="p-3 space-y-4">
        ${i.pending_downgrade ? `<div class="border border-emerald-400 bg-emerald-50 rounded p-2">
          <div class="font-semibold text-emerald-900">Suggested downgrade P${i.priority} → P${i.pending_downgrade.to}</div>
          <div class="text-xs text-emerald-900 mt-1">${esc(i.pending_downgrade.reason)}</div>
          <ul class="text-xs list-disc ml-4 mt-1 text-emerald-800">${i.pending_downgrade.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
          <div class="text-[11px] text-emerald-700 mt-1">SurgeTriage never downgrades automatically.</div>
          <div class="flex gap-2 mt-2"><button data-act="accept-down" data-id="${i.id}" class="text-xs bg-emerald-700 text-white px-2 py-1 rounded">Accept downgrade</button>
          <button data-act="reject-down" data-id="${i.id}" class="text-xs border border-emerald-600 px-2 py-1 rounded">Keep P${i.priority}</button></div></div>` : ''}
        ${i.needs_review ? `<div class="border border-yellow-400 bg-yellow-50 rounded p-2 text-xs">⚠ Extraction couldn't classify at least one call. Needs human review. The system didn't guess a category.</div>` : ''}
        ${cl ? `<div class="border border-purple-300 bg-purple-50 rounded p-2 text-xs">◌ Part of ${cl.status === 'confirmed' ? 'confirmed' : 'suggested'} root-cause cluster: <b>${esc(cl.label)}</b> (${cl.incident_ids.length} incidents, ${Math.round(cl.confidence * 100)}%)</div>` : ''}
        <div><h3 class="font-semibold mb-1">Why P${i.priority}?</h3>
          <ul class="space-y-1">${i.priority_reasons.map((r) => `<li class="text-xs bg-slate-50 border-l-4 rounded px-2 py-1" style="border-color:${P_COLORS[i.priority]}">${esc(r)}</li>`).join('')}</ul></div>
        <div><h3 class="font-semibold mb-1">Merged factors <span class="text-xs font-normal text-slate-400">(OR across all callers, # = first caller)</span></h3>
          <div class="flex flex-wrap gap-1">${Engine.BOOL_FACTORS.map(chip).join('')}
          <span class="px-1.5 py-0.5 rounded text-[11px] bg-slate-100">⏱ ${f.minutes_since_event === null ? 'time not stated' : f.minutes_since_event + ' min since event'}</span></div>
          <div class="flex flex-wrap gap-1 mt-1">${i.key_details.map((d) => `<span class="px-1.5 py-0.5 rounded text-[11px] bg-blue-50 text-blue-800">${esc(d)}</span>`).join('')}</div></div>
        <div><h3 class="font-semibold mb-1">Priority history</h3>
          ${hist.length ? `<ol class="border-l-2 border-slate-200 ml-1 space-y-2">${hist.map((h) => `<li class="ml-3 text-xs"><div>${badge(h.old_priority)} → ${badge(h.new_priority)} <span class="text-slate-400">${age(h.created_at)} ago · ${h.kind}</span></div>
            <div class="text-slate-700">${esc(h.reason)}</div>${h.triggered_by_call_id ? `<div class="text-slate-400">Triggered by call ${h.triggered_by_call_id}</div>` : ''}</li>`).join('')}</ol>` : '<div class="text-xs text-slate-400">No changes since creation.</div>'}</div>
        <div><h3 class="font-semibold mb-1">Linked calls (${calls.length})</h3>
          <div class="space-y-1">${calls.slice().reverse().map((c) => `<div class="text-xs border rounded p-1.5 ${i.sources && Object.values(i.sources).some((s) => s.callId === c.id) ? 'border-red-300 bg-red-50' : ''}">
            <div class="flex gap-2 text-slate-500"><b class="text-slate-700">#${c.caller_no}</b><span>${c.channel}</span><span>${age(c.created_at)} ago</span>${c.is_duplicate ? '<span class="text-blue-700">duplicate</span>' : '<span class="text-emerald-700">first report</span>'}${c.needs_review ? '<span class="text-yellow-700">needs review</span>' : ''}<span class="ml-auto">${c.id}</span></div>
            <div>“${esc(c.raw_text)}”</div></div>`).join('')}</div></div>
      </div>`;
  }

  function renderCallLog() {
    if ($('#view-sim').classList.contains('hidden')) return;
    const calls = store.S.calls.slice(-150).reverse();
    $('#callLog').innerHTML = calls.map((c) => {
      const i = store.byId(store.S.incidents, c.incident_id);
      return `<div class="px-3 py-1.5 text-xs flex gap-2 items-start">
        ${badge(i.priority)}<div class="flex-1 min-w-0"><div class="truncate">“${esc(c.raw_text)}”</div>
        <div class="text-slate-400">${c.id} · ${c.channel} · ${esc(c.category)} → ${c.is_duplicate ? `merged into <b>${i.id}</b> as caller #${c.caller_no}` : `new incident <b>${i.id}</b>`} · ${age(c.created_at)} ago</div></div></div>`;
    }).join('');
  }

  function select(id) {
    selectedId = id;
    const i = store.byId(store.S.incidents, id);
    showTab('dashboard');
    if (i) map.setView([i.lat, i.lng], Math.max(map.getZoom(), 14));
    render();
  }

  // ------------------------------------------------------------ actions (event delegation)
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT') return;
    const id = el.dataset.id, act = el.dataset.act;
    if (act === 'select') select(id);
    if (act === 'confirm-cluster') store.confirmCluster(id);
    if (act === 'dismiss-cluster') store.dismissCluster(id);
    if (act === 'zoom-cluster') { const c = store.byId(store.S.clusters, id); map.fitBounds(L.circle([c.lat, c.lng], { radius: c.radius_m }).addTo(map).getBounds()); }
    if (act === 'reroute') store.resolveSuggestion(+id, true);
    if (act === 'ignore') store.resolveSuggestion(+id, false);
    if (act === 'accept-down') store.acceptDowngrade(id);
    if (act === 'reject-down') store.rejectDowngrade(id);
    if (act === 'resolve') store.setStatus(id, 'resolved');
    if (act === 'dispatch') { if (!store.dispatchNearest(id)) toast('No available units', 'bg-slate-700'); }
    render();
  });
  document.addEventListener('change', (e) => {
    if (e.target.dataset.act === 'setp') { store.setPriority(e.target.dataset.id, +e.target.value); render(); }
  });

  // ------------------------------------------------------------ tabs
  function showTab(t) {
    document.querySelectorAll('.tab').forEach((b) => { b.classList.toggle('bg-slate-700', b.dataset.tab === t); });
    $('#view-dashboard').classList.toggle('hidden', t !== 'dashboard'); $('#view-dashboard').classList.toggle('flex', t === 'dashboard');
    $('#view-sim').classList.toggle('hidden', t !== 'sim'); $('#view-sim').classList.toggle('flex', t === 'sim');
    if (t === 'dashboard') setTimeout(() => map.invalidateSize(), 0);
    if (t === 'sim') renderCallLog();
  }
  document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

  // ------------------------------------------------------------ replay surge
  // Replay position survives pause/resume; Reset (or replaying after the end) starts over.
  const R = { timer: 0, idx: 0, simT: 0, lastScan: 0 };
  function stopReplay(label) { clearInterval(R.timer); R.timer = 0; $('#replayBtn').textContent = '▶ Replay surge'; $('#replayStatus').textContent = label; }
  function startReplay() {
    if (R.timer) return stopReplay('paused');
    const calls = Seed.calls;
    if (R.idx >= calls.length) { init(); Object.assign(R, { idx: 0, simT: 0, lastScan: 0 }); }
    $('#replayBtn').textContent = '❚❚ Pause';
    R.timer = setInterval(() => {
      R.simT += 0.1 * +$('#speed').value;
      while (R.idx < calls.length && calls[R.idx].t <= R.simT) store.addCall(calls[R.idx++]);
      if (R.simT - R.lastScan >= 30) { R.lastScan = R.simT; store.runRootCause(); }
      $('#replayStatus').textContent = `${R.idx}/${calls.length} calls`;
      if (R.idx >= calls.length) { store.runRootCause(); stopReplay('done'); }
      scheduleRender();
    }, 100);
  }
  $('#replayBtn').onclick = startReplay;
  $('#resetBtn').onclick = () => { stopReplay(''); Object.assign(R, { idx: 0, simT: 0, lastScan: 0 }); init(); };
  // Root-cause job also runs every 30 s of wall-clock time.
  setInterval(() => { store.runRootCause(); scheduleRender(); }, 30000);
  // Refresh ages / flashes.
  setInterval(scheduleRender, 2000);

  // ------------------------------------------------------------ call simulator + deflection
  Seed.addresses.forEach((a, n) => $('#simAddr').insertAdjacentHTML('beforeend', `<option value="${n}">${esc(a.label)}</option>`));
  $('#simAddr').insertAdjacentHTML('beforeend', '<option value="custom">Custom (from the box below)</option>');
  let custom = null;

  function currentLoc() {
    const v = $('#simAddr').value;
    if (v === 'custom') return custom;
    const a = Seed.addresses[+v];
    return { lat: a.lat, lng: a.lng, address: a.label.replace(/ \(.*\)$/, '') };
  }
  function draft() {
    const loc = currentLoc();
    const text = $('#simText').value.trim();
    if (!loc || !text) return null;
    return { raw_text: text, lat: loc.lat, lng: loc.lng, address: loc.address, channel: $('#simChannel').value };
  }

  let pv = null;
  function updatePreview() {
    const d = draft();
    if (!d) { $('#simPreview').innerHTML = ''; $('#deflect').innerHTML = ''; pv = null; return; }
    pv = store.preview(d);
    const ex = pv.ex;
    $('#simPreview').innerHTML = `<div class="border rounded p-2 bg-slate-50 text-xs">
      <div class="font-semibold mb-1">Extracted fields <span class="font-normal text-slate-400">(rules-based extractor; JSON shape matches the LLM spec)</span></div>
      <div class="flex flex-wrap gap-1 mb-1"><span class="px-1.5 rounded bg-white border">category: <b>${esc(ex.category)}</b></span>
      ${Engine.BOOL_FACTORS.filter((k) => ex[k]).map((k) => `<span class="px-1.5 rounded bg-red-100 text-red-800">${Engine.FACTOR_LABEL[k]}</span>`).join('')}
      ${ex.key_details.map((k) => `<span class="px-1.5 rounded bg-blue-50 text-blue-800">${esc(k)}</span>`).join('')}</div>
      <div>This call alone: ${badge(pv.priority)} ${esc(pv.reasons[0])}</div>
      ${ex.needs_review ? '<div class="text-yellow-700 mt-1">⚠ Unclassified. It will be flagged for human review.</div>' : ''}</div>`;
    const m = pv.match;
    if (m && pv.deflectable) {
      $('#deflect').innerHTML = `<div class="border-2 border-amber-400 bg-amber-50 rounded p-3">
        <div class="font-semibold text-amber-900">This issue was already reported by ${m.call_count} ${m.call_count === 1 ? 'person' : 'people'}. Status: ${m.status}.</div>
        <div class="text-xs text-amber-800 mb-2">${badge(m.priority)} ${esc(title(m.category))} at ${esc(m.address)} (${m.id}, opened ${age(m.created_at)} ago)</div>
        <div class="flex gap-2"><button id="dAdd" class="bg-amber-600 text-white text-xs px-2 py-1 rounded">Add new details</button>
        <button id="dText" class="bg-white border border-amber-600 text-xs px-2 py-1 rounded">Get text updates</button>
        <button id="dAny" class="bg-white border text-xs px-2 py-1 rounded">Submit anyway</button></div></div>`;
      $('#dAdd').onclick = () => submit({ force_incident_id: m.id });
      $('#dAny').onclick = () => submit({});
      $('#dText').onclick = () => {
        store.S.stats.deflected++; store.S.stats.textSubscribers++;
        $('#simResult').innerHTML = `<div class="text-emerald-700 text-xs">✓ The caller is subscribed to SMS updates for ${m.id}. No new call was created, which saves dispatcher time.</div>`;
        $('#simText').value = ''; updatePreview(); render();
      };
    } else if (m) {
      $('#deflect').innerHTML = `<div class="border border-red-300 bg-red-50 rounded p-2 text-xs text-red-900">Matches open incident ${m.id} (${esc(m.category)}, ${m.call_count} callers). <b>Not deflected</b> ${pv.priority <= 2 ? 'because this call is urgent' : 'because it mentions a life threat, weapon, fire, or vulnerable person'}. It will be merged and the priority re-checked.</div>`;
    } else {
      $('#deflect').innerHTML = `<div class="text-xs text-slate-500">No matching open incident nearby. Submitting this call creates a new master incident.</div>`;
    }
  }

  function submit(extra) {
    const d = draft(); if (!d) return;
    const r = store.addCall({ ...d, ...extra });
    $('#simResult').innerHTML = `<div class="text-xs ${r.upgraded ? 'text-red-700 font-semibold' : 'text-emerald-700'}">✓ ${r.call.id} ${r.created ? `created new incident <b>${r.incident.id}</b>` : `merged into <b>${r.incident.id}</b> as caller #${r.call.caller_no}`} ${badge(r.incident.priority)}${r.upgraded ? ' (priority upgraded)' : ''}
      <button class="underline ml-1" data-act="select" data-id="${r.incident.id}">open</button></div>`;
    $('#simText').value = '';
    updatePreview(); render();
  }

  let deb = 0;
  ['#simText', '#simAddr', '#simChannel'].forEach((s) => $(s).addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(updatePreview, 200); }));
  $('#simSubmit').onclick = () => submit({});
  document.querySelectorAll('.sample').forEach((b) => (b.onclick = () => { $('#simText').value = b.dataset.text; $('#simAddr').value = b.dataset.addr; updatePreview(); }));

  $('#geoBtn').onclick = async () => {
    const q = $('#simFree').value.trim(); if (!q) return;
    const m = q.match(/^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/);
    if (m) { custom = { lat: +m[1], lng: +m[3], address: q }; }
    else {
      $('#geoMsg').textContent = 'Looking up (Nominatim)…';
      try {
        const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q + ', New York City'));
        const j = await r.json();
        if (!j.length) { $('#geoMsg').textContent = 'Address not found. Try "lat, lng".'; return; }
        custom = { lat: +j[0].lat, lng: +j[0].lon, address: q };
      } catch { $('#geoMsg').textContent = 'Geocoder unreachable. Enter "lat, lng" instead.'; return; }
    }
    $('#geoMsg').textContent = `Located: ${custom.lat.toFixed(5)}, ${custom.lng.toFixed(5)}`;
    $('#simAddr').value = 'custom';
    updatePreview();
  };

  init();
})();
