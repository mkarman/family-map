(async function () {
  'use strict';
  const D = await (await fetch('data/family.json')).json();
  const P = D.people, S = Object.fromEntries(D.stories.map(s => [s.id, s])), PH = Object.fromEntries(D.photos.map(p => [p.id, p]));
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const year = d => { const m = String(d || '').match(/\b(\d{4})\b/); return m ? +m[1] : null; };
  const isMobile = () => matchMedia('(max-width: 760px)').matches;

  // ---------- map ----------
  const map = L.map('map', { zoomControl: true, worldCopyJump: true }).setView([42, -40], 3);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
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
    path: L.layerGroup()
  };
  const show = { photos: true, stories: true, events: true };

  // legend / layer toggles
  const Legend = L.Control.extend({
    onAdd() {
      const d = L.DomUtil.create('div', 'legend');
      d.innerHTML = `<label><input type="checkbox" data-l="photos" checked> 🖼 Photos</label>
        <label><input type="checkbox" data-l="stories" checked> 📖 Stories</label>
        <label><input type="checkbox" data-l="events" checked> ● Life events</label>`;
      L.DomEvent.disableClickPropagation(d);
      d.addEventListener('change', e => { show[e.target.dataset.l] = e.target.checked; render(); });
      return d;
    }
  });
  new Legend({ position: 'bottomleft' }).addTo(map);

  // ---------- state ----------
  let selected = null;

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
      icon: L.divIcon({ className: '', html: `<div class="ev-pin${approx ? ' approx' : ''}" style="width:${sz}px;height:${sz}px">${num || ''}</div>`, iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2], popupAnchor: [0, -6] }),
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
      if (show.photos) D.photos.filter(ph => ph.ll).forEach(ph => layers.photos.addLayer(photoMarker(ph)));
      if (show.stories) D.stories.forEach(s => storyMarkers(s).forEach(m => layers.stories.addLayer(m)));
      if (show.events) Object.values(P).forEach(p => {
        if (p.living || !p.ahn) return;
        const b = (p.events || []).find(e => e.ll && /Born|Christened|Baptized/.test(e.t));
        if (b) layers.events.addLayer(eventMarker(p, b, 0));
      });
      $('#filter-banner').hidden = true;
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
      <span class="nm">${esc(p.name)}</span>${p.years ? `<span class="yrs">${esc(p.years)}</span>` : ''}<span class="badges">${badges}</span></div>`;
    if (par.length && open) {
      const ord = par.slice().sort((a, b) => (P[a].sex === 'F') - (P[b].sex === 'F'));
      h += `<ul class="tree">${ord.map(x => nodeHTML(x, depth + 1)).join('')}</ul>`;
    }
    return h + '</li>';
  }
  function expandDepth(id, d) { if (d <= 0 || !P[id]) return; expanded.add(id); P[id].parents.forEach(x => expandDepth(x, d - 1)); }
  function renderTree() {
    const r = D.roots;
    $('#tree').innerHTML = `
      <div class="branch-title"><span class="dot" style="background:var(--w)"></span>White side</div>
      <ul class="tree root">${nodeHTML(r.W, 0)}</ul>
      <div class="branch-title"><span class="dot" style="background:var(--k)"></span>Karman side</div>
      <ul class="tree root">${nodeHTML(r.K, 0)}</ul>`;
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
    if (id) reveal(id);
    renderTree(); renderCard(); render();
    if (!opts.noHash) setHash(id ? 'person=' + encodeURIComponent(id) : '');
    if (id) { const n = document.querySelector(`.node[data-id="${CSS.escape(id)}"]`); if (n) n.scrollIntoView({ block: 'nearest' }); }
  }

  // ---------- story drawer ----------
  function openStory(sid, heroPhoto) {
    const s = S[sid]; if (!s) return;
    const hero = heroPhoto ? PH[heroPhoto] : (s.photos[0] ? PH[s.photos[0]] : null);
    const others = s.photos.filter(id => !hero || id !== hero.id);
    if (!$('#drawer').hidden && $('#drawer-body .storylist')) listScroll = $('#drawer').scrollTop;
    const backPid = selected && (P[selected].stories || []).length ? selected : null;
    let h = `<button class="back" data-list="${backPid || 'all'}">← ${backPid ? 'Stories about ' + esc(P[backPid].name) : 'All stories'}</button>`;
    h += `<p class="grp">${esc(s.group || '')}</p><h2>${esc(s.title)}</h2>`;
    if (hero) h += `<img class="hero" src="${hero.src}" data-photo="${hero.id}" alt="${esc(hero.caption)}"><p class="herocap">${esc(hero.caption)}</p>`;
    if (others.length) h += `<div class="thumbs">${others.map(id => `<img src="${PH[id].thumb}" data-photo="${id}" alt="${esc(PH[id].caption)}" title="${esc(PH[id].caption)}">`).join('')}</div>`;
    if (s.people.length) h += `<div class="people">${s.people.map(id => `<button class="chip" data-person="${id}">${esc(P[id].name)}</button>`).join('')}</div>`;
    if (s.places.length) h += `<div class="places">📍 ${s.places.map((pl, i) => `<a data-goto="${pl.ll}">${esc(pl.label)}</a>`).join(' · ')}</div>`;
    h += `<div class="story">${s.html}</div>`;
    $('#drawer-body').innerHTML = h; $('#drawer').hidden = false; $('#drawer').scrollTop = 0;
    setHash('story=' + sid);
  }
  let listScroll = 0, listFor = null;
  function storyList(pid) {
    const p = pid && P[pid];
    const items = p ? (p.stories || []).map(id => S[id]) : D.stories;
    listFor = p ? pid : null;
    let h = `<h2>${p ? 'Stories about ' + esc(p.name) : 'All stories'}</h2>`;
    if (p) h += `<p class="grp"><a class="backlink" data-list="all">See all ${D.stories.length} stories</a></p>`;
    h += `<ul class="storylist">`; let g = null;
    items.forEach(s => {
      if (s.group !== g) { g = s.group; h += `<li class="grp-h">${esc(g)}</li>`; }
      h += `<li data-story="${s.id}"><h4>${esc(s.title)}</h4><small>${esc(s.places.map(p => p.label).join(' · '))}</small></li>`;
    });
    $('#drawer-body').innerHTML = h + '</ul>'; $('#drawer').hidden = false; $('#drawer').scrollTop = 0;
    setHash(selected ? 'person=' + encodeURIComponent(selected) : '');
  }
  function closeDrawer() { $('#drawer').hidden = true; setHash(selected ? 'person=' + encodeURIComponent(selected) : ''); }
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
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#lightbox').hidden) closeLb(); else if (!$('#drawer').hidden) closeDrawer(); } });

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
  $('#btn-stories').onclick = () => storyList();
  $('#drawer').addEventListener('click', e => {
    const b = e.target.closest('[data-list]'); if (!b) return;
    const back = b.classList.contains('back');
    const pid = b.dataset.list === 'all' ? null : b.dataset.list;
    const keep = back && listFor === pid;
    storyList(pid);
    if (keep) $('#drawer').scrollTop = listScroll;
  });
  $('#toggle-sidebar').onclick = () => $('#sidebar').classList.toggle('open');
  map.on('click', () => { if (isMobile()) $('#sidebar').classList.remove('open'); });

  // ---------- search ----------
  const idx = Object.values(P).map(p => ({ id: p.id, n: p.name.toLowerCase(), p }));
  let act = -1;
  $('#search').addEventListener('input', () => {
    const q = $('#search').value.trim().toLowerCase(); const ul = $('#search-results');
    if (q.length < 2) { ul.hidden = true; return; }
    const words = q.split(/\s+/);
    const res = idx.filter(x => words.every(w => x.n.includes(w))).sort((a, b) => (!!b.p.ahn - !!a.p.ahn) || a.n.localeCompare(b.n)).slice(0, 25);
    ul.innerHTML = res.length ? res.map(x => `<li data-id="${x.id}">${esc(x.p.name)} <span class="yrs">${esc(x.p.years || '')}</span></li>`).join('') : '<li>No match</li>';
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
