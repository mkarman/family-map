(async function () {
  'use strict';
  const D = await (await fetch('data/family.json', { cache: 'no-cache' })).json();
  const P = D.people, S = Object.fromEntries(D.stories.map(s => [s.id, s])), PH = Object.fromEntries(D.photos.map(p => [p.id, p]));
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const year = d => { const m = String(d || '').match(/\b(\d{4})\b/); return m ? +m[1] : null; };
  const isMobile = () => matchMedia('(max-width: 760px)').matches;

  // ---------- map ----------
  const map = L.map('map', { zoomControl: true, worldCopyJump: true }).setView([42, -40], 3);
  const esri = 'Tiles &copy; Esri';
  const bases = {
    'Street (OpenStreetMap)': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }),
    'Satellite (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: esri + ', Maxar, Earthstar Geographics' }),
    'Topographic (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: esri }),
    'National Geographic style (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: esri + ', National Geographic' }),
    'Terrain contours (OpenTopoMap)': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '&copy; OpenStreetMap contributors, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a>' }),
    'Light gray (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: esri }),
    'US topo maps (USGS)': L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: 'USGS The National Map' })
  };
  const saved = localStorage.getItem('basemap');
  (bases[saved] || bases['Topographic (Esri)']).addTo(map);
  L.control.layers(bases, null, { position: 'topright', collapsed: true }).addTo(map);
  map.on('baselayerchange', e => { try { localStorage.setItem('basemap', e.name); } catch (_) {} });
  const clusterOpts = { maxClusterRadius: 45, showCoverageOnHover: false, spiderfyOnMaxZoom: true };
  const layers = {
    photos: L.markerClusterGroup(Object.assign({}, clusterOpts, {
      iconCreateFunction: c => {
        const m = c.getAllChildMarkers()[0];
        return L.divIcon({ className: '', html: `<div class="photo-pin" style="width:52px;height:52px;position:relative"><img src="${m.options.thumb}" alt=""><b style="position:absolute;right:2px;bottom:2px;background:#7a4b2a;color:#fff;border-radius:9px;padding:0 6px;font-size:11px">${c.getChildCount()}</b></div>`, iconSize: [52, 52], iconAnchor: [26, 26] });
      }
    })),
    stories: L.markerClusterGroup(clusterOpts),
    events: L.markerClusterGroup(Object.assign({}, clusterOpts, { maxClusterRadius: 35 })),
    path: L.layerGroup(),
    lines: L.layerGroup()
  };
  const show = { photos: true, stories: true, events: true, lines: true };

  // legend / layer toggles
  const Legend = L.Control.extend({
    onAdd() {
      const d = L.DomUtil.create('div', 'legend');
      d.innerHTML = `<label><input type="checkbox" data-l="photos" checked> 🖼 Photos</label>
        <label><input type="checkbox" data-l="stories" checked> 📖 Stories</label>
        <label><input type="checkbox" data-l="events" checked> ● Life events</label>
        <label><input type="checkbox" data-l="lines" checked> ➝ Migrations</label>
        <div class="cb">Color by <select id="cb-sel"><option value="side">Side</option><option value="line">Family line</option><option value="gen">Generation</option></select><div id="cb-key"></div></div>
        <label class="om"><input type="checkbox" id="om-on"> 📜 Old maps</label>
        <div id="om-box" hidden><select id="om-sel"></select><input type="range" id="om-op" min="20" max="100" value="75" title="Old map opacity"><div id="om-list"></div></div>`;
      L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
      d.addEventListener('change', e => { if (e.target.id === 'cb-sel') { colorBy = e.target.value; try { localStorage.setItem('colorby', colorBy); } catch (_) {} colorKey(); renderTree(); render(); return; } if (!e.target.dataset.l) return; show[e.target.dataset.l] = e.target.checked; render(); });
      return d;
    }
  });
  new Legend({ position: 'topleft' }).addTo(map);

  // ---------- colors by side / family line / generation ----------
  let colorBy = localStorage.getItem('colorby') || 'side';
  const bits = n => Math.floor(Math.log2(n));
  const SIDECOL = { W: '#b5562b', K: '#2f6f8f' };
  const LINECOL = { W4: '#b5562b', W5: '#d19a1c', W6: '#8a4fa3', W7: '#c2477a', K4: '#2f6f8f', K5: '#3c9a6b', K6: '#4b63c4', K7: '#7b8a2e' };
  function personAt(side, n) {
    let id = D.roots[side];
    for (let b = bits(n) - 1; b >= 0 && id; b--) {
      const par = (P[id].parents || []).map(x => P[x]).filter(Boolean);
      const want = (n >> b) & 1 ? 'F' : 'M';
      const q = par.find(x => want === 'F' ? x.sex === 'F' : x.sex !== 'F');
      id = q && q.id;
    }
    return id && P[id];
  }
  const LINENAME = {};
  Object.keys(LINECOL).forEach(k => { const q = personAt(k[0], +k[1]); LINENAME[k] = q ? (q.surname || q.name).split(/\s+or\s+/i)[0] : k; });
  const lineOf = p => p.ahn >= 4 ? p.side + (p.ahn >> (bits(p.ahn) - 2)) : null;
  const genOf = p => p.ahn ? bits(p.ahn) : null;
  const GMAX = Math.max(...Object.values(P).map(p => genOf(p) || 0));
  const RAMP = [[242, 193, 78], [224, 123, 57], [194, 65, 59], [142, 44, 92], [75, 42, 107], [31, 42, 90]];
  const genCol = g => { const t = Math.min(1, Math.max(0, (g - 1) / Math.max(1, Math.min(GMAX, 10) - 1))) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i; return 'rgb(' + RAMP[i].map((v, k) => Math.round(v + (RAMP[i + 1][k] - v) * f)).join(',') + ')'; };
  function colorOf(p) {
    if (!p) return '#7a4b2a';
    if (colorBy === 'line') return LINECOL[lineOf(p)] || SIDECOL[p.side];
    if (colorBy === 'gen') return p.ahn ? genCol(genOf(p)) : '#7a4b2a';
    return SIDECOL[p.side] || '#7a4b2a';
  }
  const GNAME = g => g === 1 ? 'Parents' : g === 2 ? 'Grandparents' : g === 3 ? 'Great-grandparents' : `${g - 2}× great-grandparents`;
  function colorKey() {
    $('#cb-sel').value = colorBy;
    const sw = (c, t) => `<span><i style="background:${c}"></i>${esc(t)}</span>`;
    let h = '';
    if (colorBy === 'side') h = sw(SIDECOL.W, 'White side') + sw(SIDECOL.K, 'Karman side');
    else if (colorBy === 'line') h = Object.keys(LINECOL).filter(k => side === 'all' || k[0] === side).map(k => sw(LINECOL[k], LINENAME[k] + ' line')).join('');
    else h = [1, 2, 3, 4, 5, 6, 8].filter(g => g <= GMAX).map(g => sw(genCol(g), GNAME(g))).concat(GMAX > 8 ? [sw(genCol(10), 'Older')] : []).join('');
    $('#cb-key').innerHTML = h;
  }

  // ---------- old map overlays (georeferenced by Map Warper contributors) ----------
  const OLD = [
    [68526, 'United States, 1839', [15.5, -132.3, 52.4, -60.1], 3, 7],
    [50202, 'Bohemia and Moravia', [47.25, 9.74, 53.98, 21.48], 4, 10],
    [65415, 'Dakota, Minnesota and Nebraska, 1872', [37.34, -105.94, 51.2, -87.48], 5, 10],
    [110759, 'Missouri, 1833', [35.23, -95.54, 41.76, -88.15], 5, 10],
    [66847, 'Indiana, 1850', [36.92, -89.28, 42.78, -82.38], 5, 11],
    [92046, 'Ohio, 1831', [37.28, -86.61, 42.73, -77.2], 5, 11],
    [98178, 'Pennsylvania, 1796', [39.51, -80.72, 42.67, -74.67], 5, 11],
    [55546, 'Virginia, West Virginia and Maryland, 1868', [34.73, -84.03, 40.8, -74.67], 5, 11],
    [91903, 'Maryland, 1855', [36.78, -79.99, 40.83, -74.43], 6, 12],
    [81548, 'New Jersey, 1795', [38.95, -75.63, 41.43, -73.71], 6, 12],
    [39230, 'St. Louis, topographical map', [38.29, -90.79, 38.95, -90.06], 8, 15],
    [79224, 'Pueblo area, USGS 1891', [37.95, -105.05, 38.53, -104.47], 8, 15],
    [64221, 'Denver, 1859', [39.71, -105.05, 39.79, -104.96], 11, 17]
  ];
  map.createPane('old'); map.getPane('old').style.zIndex = 250; map.getPane('old').style.opacity = .75;
  const oldLayers = OLD.map(([id, title, b, minZ, maxZ], i) => ({ title, minZ, maxZ, bounds: L.latLngBounds([b[0], b[1]], [b[2], b[3]]),
    layer: L.tileLayer(`https://mapwarper.net/maps/tile/${id}/{z}/{x}/{y}.png`, { pane: 'old', bounds: [[b[0], b[1]], [b[2], b[3]]], minZoom: minZ, maxZoom: maxZ, zIndex: i + 1 }), id }));
  let oldPick = 'auto', oldCur = null;
  const area = o => (o.bounds.getNorth() - o.bounds.getSouth()) * (o.bounds.getEast() - o.bounds.getWest());
  function bestOld() {
    const z = map.getZoom(), c = map.getCenter();
    return oldLayers.filter(o => z >= o.minZ - 1 && z <= o.maxZ && o.bounds.contains(c)).sort((x, y) => area(x) - area(y))[0] || null;
  }
  function showOld() {
    const on = $('#om-on').checked;
    const want = !on ? null : oldPick === 'auto' ? bestOld() : oldLayers[+oldPick];
    if (want !== oldCur) { if (oldCur) map.removeLayer(oldCur.layer); if (want) want.layer.addTo(map); oldCur = want; }
    if (on) $('#om-list').innerHTML = (want ? `<a href="https://mapwarper.net/maps/${want.id}" target="_blank" rel="noopener">${esc(want.title)}</a>` : 'No old map here. Zoom out or move the map.') + '<br><small>Georeferenced by Map Warper contributors</small>';
  }
  function setOld(on) {
    $('#om-box').hidden = !on; showOld();
    map.attributionControl[on ? 'addAttribution' : 'removeAttribution']('Old maps: <a href="https://mapwarper.net" target="_blank" rel="noopener">Map Warper</a>');
    try { localStorage.setItem('oldmaps', on ? '1' : ''); } catch (_) {}
  }
  $('#om-sel').innerHTML = '<option value="auto">Best map for this view</option>' + oldLayers.map((o, i) => `<option value="${i}">${esc(o.title)}</option>`).join('');
  $('#om-sel').onchange = e => {
    oldPick = e.target.value;
    if (oldPick !== 'auto') { const o = oldLayers[+oldPick]; map.flyToBounds(o.bounds, { maxZoom: o.minZ + 2, duration: 1.2 }); }
    showOld();
  };
  map.on('moveend zoomend', () => { if ($('#om-on').checked) showOld(); });
  $('#om-on').onchange = e => setOld(e.target.checked);
  $('#om-op').oninput = e => map.getPane('old').style.opacity = e.target.value / 100;
  if (localStorage.getItem('oldmaps')) { $('#om-on').checked = true; setOld(true); }

  // ---------- migrations ----------
  const birthOf = p => (p.events || []).find(e => e.ll && /Born|Christened|Baptized/.test(e.t) && e.prec !== 'country');
  const dist = (a, b) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * Math.cos(a[0] * Math.PI / 180)) * 111;
  const MIG = (() => {
    const m = {};
    Object.values(P).forEach(p => {
      if (p.living || !p.ahn) return;
      const b = birthOf(p); if (!b) return;
      p.parents.forEach(q => {
        const pq = P[q]; if (!pq || pq.living) return;
        const a = birthOf(pq); if (!a || dist(a.ll, b.ll) < 40) return;
        const k = a.ll + '|' + b.ll;
        (m[k] = m[k] || { from: a, to: b, people: new Set(), side: p.side, year: year(b.date) || year(a.date) && year(a.date) + 25 }).people.add(p.id);
      });
    });
    return Object.values(m).map(x => Object.assign(x, { people: [...x.people] }));
  })();
  function migrationLayer(list, faded) {
    list.forEach(mg => {
      const col = colorOf(P[mg.people[0]]);
      const f = map.project(mg.from.ll, 3), t = map.project(mg.to.ll, 3);
      const mx = (f.x + t.x) / 2, my = (f.y + t.y) / 2, dx = t.x - f.x, dy = t.y - f.y;
      const c = L.point(mx - dy * .18, my + dx * .18);
      const q = u => L.point((1 - u) * (1 - u) * f.x + 2 * (1 - u) * u * c.x + u * u * t.x, (1 - u) * (1 - u) * f.y + 2 * (1 - u) * u * c.y + u * u * t.y);
      const pts = []; for (let i = 0; i <= 24; i++) pts.push(map.unproject(q(i / 24), 3));
      const fade = faded && faded(mg);
      const line = L.polyline(pts, { color: col, weight: 2, opacity: fade ? .25 : .7 });
      const names = mg.people.map(id => `<a data-person="${id}">${esc(P[id].name)}</a>`).join(', ');
      line.bindPopup(`<h4>Family move</h4>From ${esc(mg.from.place)}<br>to ${esc(mg.to.place)}${mg.year ? ' (by ' + mg.year + ')' : ''}<br><small>Born at the new place: ${names}</small>`);
      layers.lines.addLayer(line);
      const p0 = q(.68), p1 = q(.72);
      const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180 / Math.PI;
      layers.lines.addLayer(L.marker(map.unproject(q(.7), 3), { interactive: false, icon: L.divIcon({ className: '', html: `<div class="arrow" style="transform:rotate(${ang}deg);border-left-color:${col};opacity:${fade ? .35 : .9}"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] }) }));
    });
  }

  // ---------- timeline ----------
  let tl = null; // null = all years, else the current year
  const allYears = Object.values(P).filter(p => p.ahn && !p.living).flatMap(p => (p.events || []).map(e => year(e.date)).filter(Boolean));
  const Y0 = Math.max(1600, Math.floor(Math.min(...allYears) / 10) * 10), Y1 = Math.min(2000, Math.ceil(Math.max(...allYears) / 10) * 10);
  const WINDOW = 25;
  let playTimer = null;
  const TL = L.Control.extend({
    onAdd() {
      const d = L.DomUtil.create('div', 'timeline');
      d.innerHTML = `<button id="tl-play" title="Play through the years">▶</button>
        <input id="tl-range" type="range" min="${Y0}" max="${Y1}" step="5" value="${Y0}" aria-label="Year">
        <span id="tl-year">All years</span>
        <button id="tl-all" title="Show all years" hidden>✕</button>`;
      L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
      return d;
    }
  });
  new TL({ position: 'bottomright' }).addTo(map);
  function setYear(y) {
    tl = y; $('#tl-year').textContent = y == null ? 'All years' : y; $('#tl-all').hidden = y == null;
    if (y != null) $('#tl-range').value = y;
    if (selected && y != null) { selected = null; renderTree(); renderCard(); setHash(''); }
    render();
  }
  function stopPlay() { clearInterval(playTimer); playTimer = null; $('#tl-play').textContent = '▶'; }
  $('#tl-range').addEventListener('input', e => { stopPlay(); setYear(+e.target.value); });
  $('#tl-all').onclick = () => { stopPlay(); setYear(null); };
  $('#tl-play').onclick = () => {
    if (playTimer) return stopPlay();
    let y = tl == null || tl >= Y1 ? Y0 : tl;
    $('#tl-play').textContent = '❚❚'; setYear(y);
    playTimer = setInterval(() => { y += 5; if (y > Y1) { stopPlay(); return; } setYear(y); }, 700);
  };

  // ---------- state ----------
  let selected = null;
  let side = 'all';
  colorKey();
  const photoSide = ph => (ph.people[0] && P[ph.people[0]] && P[ph.people[0]].side) || (ph.story && S[ph.story].side) || 'W';
  const onSide = x => side === 'all' || x === side;

  function photoMarker(ph) {
    const sz = 46;
    const m = L.marker(ph.ll, {
      thumb: ph.thumb,
      icon: L.divIcon({ className: '', html: `<div class="photo-pin" style="width:${sz}px;height:${sz}px"><img src="${ph.thumb}" alt="${esc(ph.caption)}" loading="lazy"></div>`, iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2] }),
      title: ph.caption
    });
    m.on('click', () => openPhoto(ph.id, true));
    return m;
  }
  function storyMarkers(s) {
    return s.places.map(pl => {
      const m = L.marker(pl.ll, {
        icon: L.divIcon({ className: '', html: `<div class="story-pin side-${s.side}"><span>📖</span></div>`, iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28] }),
        title: s.title
      });
      const th = s.photos.slice(0, 4).map(id => `<img src="${PH[id].thumb}" data-photo="${id}" alt="">`).join('');
      m.bindPopup(`<h4>${esc(s.title)}</h4><div>${esc(pl.label)}</div>${th ? `<div class="pop-thumbs">${th}</div>` : ''}<p><a data-story="${s.id}">Read the story →</a></p>`);
      return m;
    });
  }
  function fitTo(pts) {
    map.invalidateSize();
    const b = L.latLngBounds(pts);
    const small = Math.abs(b.getNorth() - b.getSouth()) < 0.3 && Math.abs(b.getEast() - b.getWest()) < 0.3;
    if (small) map.setView(b.getCenter(), 10, { animate: false });
    else map.fitBounds(b.pad(0.25), { maxZoom: 9, animate: false });
  }
  window.addEventListener('resize', () => map.invalidateSize());
  function evLabel(e) { return `${e.t}${e.date ? ' ' + e.date : ''}`; }
  const PREC = { county: 'approximate: county', state: 'approximate: state', country: 'approximate: country' };

  function eventMarker(p, e, num) {
    const approx = PREC[e.prec];
    const sz = num ? 22 : 12;
    const m = L.marker(e.ll, {
      icon: L.divIcon({ className: '', html: `<div class="ev-pin${approx ? ' approx' : ''}" style="width:${sz}px;height:${sz}px${num ? '' : ';background:' + colorOf(p) + (approx ? ';opacity:.6' : '')}">${num || ''}</div>`, iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2], popupAnchor: [0, -6] }),
      title: `${p.name}: ${evLabel(e)}`
    });
    m.bindPopup(`<h4><a data-person="${p.id}">${esc(p.name)}</a></h4>${esc(evLabel(e))}<br>${esc(e.place)}${e.note ? '<br><i>' + esc(e.note) + '</i>' : ''}${approx ? `<br><small>(${approx})</small>` : ''}`);
    return m;
  }

  function sortedEvents(p) {
    const rank = t => t === 'Born' || t === 'Christened' || t === 'Baptized' ? 0 : t === 'Died' ? 2 : t === 'Buried' ? 3 : 1;
    return (p.events || []).slice().sort((a, b) => {
      const ra = rank(a.t), rb = rank(b.t);
      if (ra === 0 && rb !== 0) return -1; if (rb === 0 && ra !== 0) return 1;
      if (ra >= 2 && rb < 2) return 1; if (rb >= 2 && ra < 2) return -1;
      return (year(a.date) ?? 9999) - (year(b.date) ?? 9999) || ra - rb;
    });
  }

  function render() {
    Object.values(layers).forEach(l => { l.clearLayers(); map.removeLayer(l); });
    const pts = [];
    if (!selected) {
      if (tl == null) {
        if (show.photos) D.photos.filter(ph => ph.ll && onSide(photoSide(ph))).forEach(ph => layers.photos.addLayer(photoMarker(ph)));
        if (show.stories) D.stories.filter(s => onSide(s.side)).forEach(s => storyMarkers(s).forEach(m => layers.stories.addLayer(m)));
        if (show.events) Object.values(P).forEach(p => {
          if (p.living || !p.ahn || !onSide(p.side)) return;
          const b = (p.events || []).find(e => e.ll && /Born|Christened|Baptized/.test(e.t));
          if (b) layers.events.addLayer(eventMarker(p, b, 0));
        });
        if (show.lines) migrationLayer(MIG.filter(m => onSide(m.side)));
        $('#filter-banner').hidden = true;
      } else {
        let n = 0;
        if (show.events) Object.values(P).forEach(p => {
          if (p.living || !p.ahn || !onSide(p.side)) return;
          (p.events || []).forEach(e => { const y = year(e.date); if (e.ll && y && y > tl - WINDOW && y <= tl) { layers.events.addLayer(eventMarker(p, e, 0)); n++; } });
        });
        if (show.lines) migrationLayer(MIG.filter(m => onSide(m.side) && m.year && m.year <= tl), m => m.year <= tl - WINDOW);
        $('#filter-banner').innerHTML = `<span><b>${tl - WINDOW + 1}–${tl}</b>: ${n} life event${n === 1 ? '' : 's'} on the map. Older moves are faded.</span><button id="clear-sel">All years</button>`;
        $('#filter-banner').hidden = false;
        $('#clear-sel').onclick = () => { stopPlay(); setYear(null); };
      }
    } else {
      const p = P[selected];
      const evs = sortedEvents(p).filter(e => e.ll);
      if (show.events) {
        evs.forEach((e, i) => { layers.path.addLayer(eventMarker(p, e, i + 1)); pts.push(e.ll); });
        const line = evs.map(e => e.ll);
        if (line.length > 1) layers.path.addLayer(L.polyline(line, { color: '#7a4b2a', weight: 2, dashArray: '5 6', opacity: .7 }));
      }
      if (show.photos) (p.photos || []).map(id => PH[id]).filter(ph => ph.ll).forEach(ph => { layers.path.addLayer(photoMarker(ph)); pts.push(ph.ll); });
      if (show.stories) (p.stories || []).map(id => S[id]).forEach(s => storyMarkers(s).forEach(m => { layers.path.addLayer(m); pts.push(m.getLatLng()); }));
      const n = (p.photos || []).length, ns = (p.stories || []).length;
      $('#filter-banner').innerHTML = `<span>Showing <b>${esc(p.name)}</b>: ${evs.length} place${evs.length === 1 ? '' : 's'}, ${n} photo${n === 1 ? '' : 's'}, ${ns} stor${ns === 1 ? 'y' : 'ies'}</span><button id="clear-sel">Show everyone</button>`;
      $('#filter-banner').hidden = false;
      $('#clear-sel').onclick = () => select(null);
    }
    Object.entries(layers).forEach(([k, l]) => { if (l.getLayers().length) l.addTo(map); });
    if (selected && pts.length) fitTo(pts);
  }

  // ---------- tree ----------
  const expanded = new Set();
  function nodeHTML(id, depth) {
    const p = P[id]; if (!p) return '';
    const par = p.parents.filter(x => P[x]);
    const open = expanded.has(id);
    const badges = [(p.photos || []).length ? '🖼' : '', (p.stories || []).length ? '📖' : ''].join('');
    let h = `<li><div class="node${p.living ? ' living' : ''}${selected === id ? ' selected' : ''}" data-id="${id}">
      <span class="caret${par.length ? '' : ' empty'}" data-toggle="${id}">${open ? '▼' : '▶'}</span>
      <span class="nm">${p.ahn ? `<i class="ln" style="background:${colorOf(p)}"></i>` : ''}${esc(p.name)}${p.aka ? ` <i class="aka">"${esc(p.aka)}"</i>` : ''}</span>${p.years ? `<span class="yrs">${esc(p.years)}</span>` : ''}<span class="badges">${badges}</span></div>`;
    if (par.length && open) {
      const ord = par.slice().sort((a, b) => (P[a].sex === 'F') - (P[b].sex === 'F'));
      h += `<ul class="tree">${ord.map(x => nodeHTML(x, depth + 1)).join('')}</ul>`;
    }
    return h + '</li>';
  }
  function expandDepth(id, d) { if (d <= 0 || !P[id]) return; expanded.add(id); P[id].parents.forEach(x => expandDepth(x, d - 1)); }
  function renderTree() {
    const r = D.roots;
    $('#tree').innerHTML = (onSide('W') ? `
      <div class="branch-title"><span class="dot" style="background:var(--w)"></span>White side</div>
      <ul class="tree root">${nodeHTML(r.W, 0)}</ul>` : '') + (onSide('K') ? `
      <div class="branch-title"><span class="dot" style="background:var(--k)"></span>Karman side</div>
      <ul class="tree root">${nodeHTML(r.K, 0)}</ul>` : '');
  }
  $('#tree').addEventListener('click', e => {
    const t = e.target.closest('[data-toggle]');
    if (t && !t.classList.contains('empty')) { const id = t.dataset.toggle; expanded.has(id) ? expanded.delete(id) : expanded.add(id); renderTree(); return; }
    const n = e.target.closest('.node'); if (n) select(n.dataset.id);
  });
  // reveal a person in the tree by expanding their descendants' path
  function reveal(id) {
    const r = Object.values(D.roots);
    const path = (from, target, seen = new Set()) => {
      if (from === target) return [from];
      if (seen.has(from)) return null; seen.add(from);
      for (const x of (P[from]?.parents || [])) { const q = path(x, target, seen); if (q) return [from, ...q]; }
      return null;
    };
    for (const root of r) { const q = path(root, id); if (q) { q.slice(0, -1).forEach(x => expanded.add(x)); return true; } }
    return false;
  }

  // ---------- person card ----------
  function personLink(id) { const p = P[id]; return p ? `<a data-person="${id}">${esc(p.name)}</a>` : ''; }
  function renderCard() {
    const c = $('#person-card');
    if (!selected) { c.hidden = true; return; }
    const p = P[selected];
    let h = `<button class="card-close" id="card-close" aria-label="Close">×</button><h2>${esc(p.name)}</h2>`;
    if (p.living) {
      h += `<p class="rel">Living person. Details are kept private.</p>`;
    } else {
      h += `<p class="rel">${esc(p.years || '')}${p.rel ? ' · ' + esc(p.rel) : ''}</p>`;
      if (p.aka) h += `<p class="aka-line">Also known as <b>"${esc(p.aka)}"</b>${p.note ? '. ' + esc(p.note) : ''}</p>`;
      const evs = sortedEvents(p); let n = 0;
      if (evs.length) h += `<h3>Life events</h3><ul class="evlist">${evs.map(e => {
        const num = e.ll ? ++n : '';
        return `<li ${e.ll ? `data-ll="${e.ll}"` : ''}><span class="n${e.ll ? '' : ' nomap'}">${num || '–'}</span><span><b>${esc(e.t)}</b> ${esc(e.date)}${e.place ? ', ' + esc(e.place) : ''}${e.with ? ' (to ' + personLink(e.with) + ')' : ''}${e.note ? ' · <i>' + esc(e.note) + '</i>' : ''}${PREC[e.prec] ? ` <span class="approx">(${PREC[e.prec]})</span>` : ''}</span></li>`;
      }).join('')}</ul>`;
    }
    if ((p.stories || []).length) h += `<h3>Stories</h3><div class="links">${p.stories.map(id => `<a data-story="${id}">${esc(S[id].title)}</a>`).join('')}</div>`;
    if ((p.photos || []).length) h += `<h3>Photos</h3><div class="thumbs">${p.photos.map(id => `<img src="${PH[id].thumb}" data-photo="${id}" alt="${esc(PH[id].caption)}" title="${esc(PH[id].caption)}">`).join('')}</div>`;
    const fam = [['Parents', p.parents], ['Spouses', p.spouses], ['Children', p.children]].filter(([, l]) => l && l.length);
    fam.forEach(([k, l]) => { h += `<h3>${k}</h3><div class="links">${l.map(personLink).join('')}</div>`; });
    c.innerHTML = h; c.hidden = false; c.scrollTop = 0;
    $('#card-close').onclick = () => select(null);
  }
  $('#person-card').addEventListener('click', e => {
    const li = e.target.closest('li[data-ll]');
    if (li && !e.target.closest('a')) { const [a, b] = li.dataset.ll.split(',').map(Number); map.setView([a, b], 10); if (isMobile()) $('#sidebar').classList.remove('open'); }
  });

  function select(id, opts = {}) {
    selected = id;
    if (id && tl != null) { stopPlay(); tl = null; $('#tl-year').textContent = 'All years'; $('#tl-all').hidden = true; }
    if (id) reveal(id);
    renderTree(); renderCard(); render();
    if (!opts.noHash) setHash(id ? 'person=' + encodeURIComponent(id) : '');
    if (id) { const n = document.querySelector(`.node[data-id="${CSS.escape(id)}"]`); if (n) n.scrollIntoView({ block: 'nearest' }); }
  }

  // ---------- story drawer ----------
  let tour = null;
  function startTour(pid) {
    const p = pid && P[pid];
    const list = (p ? (p.stories || []) : D.stories.filter(s => onSide(s.side)).map(s => s.id));
    if (!list.length) return;
    tour = { list, i: 0, pid: p ? pid : null };
    openStory(list[0], null, true);
  }
  function tourStep(d) {
    if (!tour) return;
    tour.i = Math.max(0, Math.min(tour.list.length - 1, tour.i + d));
    openStory(tour.list[tour.i], null, true);
  }
  function flyToStory(s) {
    const lls = s.places.map(p => p.ll).filter(ll => ll && ll[0] > -80);
    if (!lls.length) return;
    if (isMobile()) return;
    const b = L.latLngBounds(lls);
    const opts = { paddingTopLeft: [40, 40], paddingBottomRight: [$('#drawer').offsetWidth + 40, 60], maxZoom: 9, duration: 1.6 };
    if (lls.length === 1 || b.getNorthEast().distanceTo(b.getSouthWest()) < 5000) map.flyTo(lls[0], 9, { duration: 1.6 });
    else map.flyToBounds(b, opts);
  }
  function openStory(sid, heroPhoto, fromTour) {
    const s = S[sid]; if (!s) return;
    if (!fromTour) tour = null;
    const hero = heroPhoto ? PH[heroPhoto] : (s.photos[0] ? PH[s.photos[0]] : null);
    const others = s.photos.filter(id => !hero || id !== hero.id);
    if (!$('#drawer').hidden && $('#drawer-body .storylist')) listScroll = $('#drawer').scrollTop;
    const backPid = selected && (P[selected].stories || []).length ? selected : null;
    let h = `<button class="back" data-list="${backPid || 'all'}">← ${backPid ? 'Stories about ' + esc(P[backPid].name) : 'All stories'}</button>`;
    const tourBar = tour ? `<div class="tourbar"><button class="tour-nav" data-tour="-1" ${tour.i ? '' : 'disabled'}>‹ Previous</button><span>Tour · ${tour.i + 1} of ${tour.list.length}</span><button class="tour-nav" data-tour="1" ${tour.i < tour.list.length - 1 ? '' : 'disabled'}>Next story ›</button></div>` : '';
    h += tourBar;
    h += `<p class="grp">${esc(s.group || '')}</p><h2>${esc(s.title)}</h2>`;
    if (hero) h += `<img class="hero" src="${hero.src}" data-photo="${hero.id}" alt="${esc(hero.caption)}"><p class="herocap">${esc(hero.caption)}</p>`;
    if (others.length) h += `<div class="thumbs">${others.map(id => `<img src="${PH[id].thumb}" data-photo="${id}" alt="${esc(PH[id].caption)}" title="${esc(PH[id].caption)}">`).join('')}</div>`;
    if (s.people.length) h += `<div class="people">${s.people.map(id => `<button class="chip" data-person="${id}">${esc(P[id].name)}</button>`).join('')}</div>`;
    if (s.places.length) h += `<div class="places">📍 ${s.places.map((pl, i) => `<a data-goto="${pl.ll}">${esc(pl.label)}</a>`).join(' · ')}</div>`;
    h += `<div class="story">${s.html}</div>`;
    if (tour) h += tourBar.replace('class="tourbar"', 'class="tourbar end"');
    $('#drawer-body').innerHTML = h; $('#drawer').hidden = false; $('#drawer').scrollTop = 0;
    setHash('story=' + sid);
    if (fromTour) flyToStory(s);
  }
  let listScroll = 0, listFor = null;
  function storyList(pid) {
    const p = pid && P[pid];
    const items = p ? (p.stories || []).map(id => S[id]) : D.stories.filter(s => onSide(s.side));
    listFor = p ? pid : null;
    let h = `<h2>${p ? 'Stories about ' + esc(p.name) : side === 'all' ? 'All stories' : (side === 'W' ? 'White' : 'Karman') + ' side stories'}</h2>`;
    if (p) h += `<p class="grp"><a class="backlink" data-list="all">See all stories</a></p>`;
    if (items.length > 1) h += `<button class="tour-start" data-tourstart="${p ? pid : ''}">▶ Take the guided tour (${items.length} stories)</button>`;
    h += `<ul class="storylist">`; let g = null;
    items.forEach(s => {
      if (s.group !== g) { g = s.group; h += `<li class="grp-h">${esc(g)}</li>`; }
      h += `<li data-story="${s.id}"><h4>${esc(s.title)}</h4><small>${esc(s.places.map(p => p.label).join(' · '))}</small></li>`;
    });
    $('#drawer-body').innerHTML = h + '</ul>'; $('#drawer').hidden = false; $('#drawer').scrollTop = 0;
    setHash(selected ? 'person=' + encodeURIComponent(selected) : '');
  }
  function closeDrawer() { tour = null; $('#drawer').hidden = true; setHash(selected ? 'person=' + encodeURIComponent(selected) : ''); }
  $('#drawer-close').onclick = closeDrawer;

  // ---------- photos ----------
  function openPhoto(id, fromMap) {
    const ph = PH[id];
    if (fromMap && ph.story) { openStory(ph.story, id); return; }
    $('#lb-img').src = ph.src; $('#lb-img').alt = ph.caption;
    const ppl = ph.people.map(x => `<a data-person="${x}">${esc(P[x].name)}</a>`).join(', ');
    $('#lb-cap').innerHTML = `${esc(ph.caption)}${ph.place ? ' · ' + esc(ph.place) : ''}${ppl ? '<br>' + ppl : ''}${ph.story && $('#drawer').hidden ? `<br><a data-story="${ph.story}">Read the story →</a>` : ''}`;
    $('#lightbox').hidden = false;
  }
  const closeLb = () => { $('#lightbox').hidden = true; };
  $('#lb-close').onclick = closeLb;
  $('#lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') closeLb(); });
  document.addEventListener('keydown', e => { if (tour && $('#lightbox').hidden && !e.target.closest('input') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { tourStep(e.key === 'ArrowRight' ? 1 : -1); return; } if (e.key === 'Escape') { if (!$('#lightbox').hidden) closeLb(); else if (!$('#drawer').hidden) closeDrawer(); } });

  // ---------- global link handling ----------
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-person],[data-story],[data-photo],[data-goto]');
    if (!a || a.closest('#tree')) return;
    if (a.dataset.person) { closeLb(); select(a.dataset.person); if (isMobile()) { $('#drawer').hidden = true; $('#sidebar').classList.add('open'); } }
    else if (a.dataset.story) { closeLb(); map.closePopup(); openStory(a.dataset.story); }
    else if (a.dataset.photo) openPhoto(a.dataset.photo, false);
    else if (a.dataset.goto) { const [x, y] = a.dataset.goto.split(',').map(Number); map.setView([x, y], 9); if (isMobile()) $('#drawer').hidden = true; }
  });
  $('#btn-all').onclick = () => select(null);
  function fitAll() {
    const all = [...D.photos.filter(p => p.ll && onSide(photoSide(p))).map(p => p.ll), ...D.stories.filter(s => onSide(s.side)).flatMap(s => s.places.map(p => p.ll))].filter(ll => ll[0] > 20);
    if (all.length) map.fitBounds(L.latLngBounds(all).pad(0.05), { animate: false });
  }
  document.querySelectorAll('[data-side]').forEach(b => b.onclick = () => {
    side = b.dataset.side; colorKey();
    document.querySelectorAll('[data-side]').forEach(x => x.classList.toggle('on', x === b));
    if (selected && !onSide(P[selected].side)) select(null); else { renderTree(); render(); }
    if (!selected) fitAll();
    if (!$('#drawer').hidden && $('#drawer-body .storylist') && !listFor) storyList();
  });
  $('#btn-stories').onclick = () => storyList();
  $('#drawer').addEventListener('click', e => {
    const t = e.target.closest('[data-tour],[data-tourstart]');
    if (t) { if (t.dataset.tour) tourStep(+t.dataset.tour); else startTour(t.dataset.tourstart || null); return; }
    const b = e.target.closest('[data-list]'); if (!b) return;
    tour = null;
    const back = b.classList.contains('back');
    const pid = b.dataset.list === 'all' ? null : b.dataset.list;
    const keep = back && listFor === pid;
    storyList(pid);
    if (keep) $('#drawer').scrollTop = listScroll;
  });
  $('#toggle-sidebar').onclick = () => $('#sidebar').classList.toggle('open');
  map.on('click', () => { if (isMobile()) $('#sidebar').classList.remove('open'); });

  // ---------- search ----------
  const idx = Object.values(P).map(p => ({ id: p.id, n: (p.name + ' ' + (p.aka || '')).toLowerCase(), p }));
  let act = -1;
  $('#search').addEventListener('input', () => {
    const q = $('#search').value.trim().toLowerCase(); const ul = $('#search-results');
    if (q.length < 2) { ul.hidden = true; return; }
    const words = q.split(/\s+/);
    const res = idx.filter(x => words.every(w => x.n.includes(w))).sort((a, b) => (!!b.p.ahn - !!a.p.ahn) || a.n.localeCompare(b.n)).slice(0, 25);
    ul.innerHTML = res.length ? res.map(x => `<li data-id="${x.id}">${esc(x.p.name)}${x.p.aka ? ` <i>"${esc(x.p.aka)}"</i>` : ''} <span class="yrs">${esc(x.p.years || '')}</span></li>`).join('') : '<li>No match</li>';
    ul.hidden = false; act = -1;
  });
  $('#search').addEventListener('keydown', e => {
    const lis = [...$('#search-results').querySelectorAll('li[data-id]')]; if (!lis.length) return;
    if (e.key === 'ArrowDown') act = Math.min(act + 1, lis.length - 1); else if (e.key === 'ArrowUp') act = Math.max(act - 1, 0);
    else if (e.key === 'Enter') { (lis[act] || lis[0]).click(); return; } else return;
    e.preventDefault(); lis.forEach((l, i) => l.classList.toggle('active', i === act));
  });
  $('#search-results').addEventListener('click', e => {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    $('#search-results').hidden = true; $('#search').value = ''; select(li.dataset.id);
  });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) $('#search-results').hidden = true; });

  // ---------- hash routing ----------
  function setHash(h) { history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); }
  function fromHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('person') && P[h.get('person')]) select(h.get('person'), { noHash: true });
    if (h.get('story') && S[h.get('story')]) openStory(h.get('story'));
  }

  // init
  expandDepth(D.roots.W, 4); expandDepth(D.roots.K, 4);
  renderTree(); render();
  const all = [...D.photos.filter(p => p.ll).map(p => p.ll), ...D.stories.flatMap(s => s.places.map(p => p.ll))].filter(ll => ll[0] > 20);
  if (all.length && !/person=/.test(location.hash)) map.fitBounds(L.latLngBounds(all).pad(0.05), { animate: false });
  fromHash();
})();
