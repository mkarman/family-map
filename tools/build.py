#!/usr/bin/env python3
"""Rebuild data/family.json and img/ for the family map site.

Usage:  python3 tools/build.py [--project /mnt/project-files] [--out .]

Inputs (all in the project's shared folder):
  family-tree-audit/working-tree/white-family-tree-*.ged   newest White tree export
  family-tree-audit/karman-side/karman-family-tree-*.ged   newest Karman tree export
  family-map-site/sources/white-stories-family-copy.md     "Our Family Stories (family copy)" exported as Markdown
  family-map-site/sources/karman-stories.md                "Karman Family Stories" exported as Markdown
  family-map-site/geo/                                     place-name gazetteer
Config (in this folder): stories.json, photos.json, place_overrides.json
Privacy rules: family-map-site/private/privacy.json in the project folder (not in this public repo)
"""
import sys, os, re, json, glob, math, argparse
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from ged import parse, get, gets
from geocode import geocode
from stories import split

ap = argparse.ArgumentParser()
ap.add_argument('--project', default='/mnt/project-files')
ap.add_argument('--out', default=os.path.dirname(HERE))
args = ap.parse_args()
PROJ, OUT = args.project, args.out
AUD = os.path.join(PROJ, 'family-tree-audit')
SRC = os.path.join(PROJ, 'family-map-site', 'sources')
cfg = lambda n: json.load(open(os.path.join(HERE, n)))
PRIV = json.load(open(os.path.join(PROJ, 'family-map-site', 'private', 'privacy.json')))  # kept out of the public repo
STORY_CFG, PHOTO_CFG = cfg('stories.json'), cfg('photos.json')
report = []
def note(s): report.append(s); print(s)

def newest(pattern):
    L = sorted(glob.glob(os.path.join(AUD, pattern)))
    if not L: sys.exit('missing ' + pattern)
    return L[-1]
WG, KG = newest('working-tree/white-family-tree-*.ged'), newest('karman-side/karman-family-tree-*.ged')
note(f'Trees: {os.path.relpath(WG, PROJ)}, {os.path.relpath(KG, PROJ)}')
W, K = parse(WG), parse(KG)

# ---------- people ----------
def load(R, pre):
    P, F = {}, {}
    for k, v in R.items():
        if v['tag'] == 'INDI': P[pre + v['id']] = v
        elif v['tag'] == 'FAM': F[pre + v['id']] = v
    return P, F
WP, WF = load(W, 'W'); KP, KF = load(K, 'K')
nm = lambda v: (get(v, 'NAME') or {'val': ''})['val']
def find(P, prefix):
    return [k for k, v in P.items() if nm(v).startswith(prefix)]
KRISTIN = find(WP, 'Kristin')[0]
MICHAEL = find(WP, 'Michael Andrew')[0]
def parents_of(P, F, pre, i):
    out = []
    for c in gets(P[i], 'FAMC'):
        f = pre + c['val']
        if f in F: out += [pre + x['val'] for x in F[f]['ch'] if x['tag'] in ('HUSB', 'WIFE')]
    return out
# join the Karman tree onto the White tree at Michael and his parents
MAP = {find(KP, 'Michael')[0]: MICHAEL, find(KP, 'Kristin')[0]: KRISTIN}
for kp in parents_of(KP, KF, 'K', find(KP, 'Michael')[0]):
    first = nm(KP[kp]).split('/')[0].split()[0]
    w = [x for x in parents_of(WP, WF, 'W', MICHAEL) if nm(WP[x]).startswith(first)]
    if w: MAP[kp] = w[0]
drop, stack = set(), []
for w in set(MAP.values()) - {MICHAEL, KRISTIN}: stack += parents_of(WP, WF, 'W', w)
while stack:
    x = stack.pop()
    if x in drop or x not in WP: continue
    drop.add(x); stack += parents_of(WP, WF, 'W', x)

EV = {'BIRT': 'Born', 'CHR': 'Christened', 'BAPM': 'Baptized', 'DEAT': 'Died', 'BURI': 'Buried', 'RESI': 'Lived', 'CENS': 'Census',
      'IMMI': 'Immigrated', 'EMIG': 'Emigrated', 'NATU': 'Naturalized', 'EVEN': 'Event', 'OCCU': 'Occupation', 'PROB': 'Probate', 'DIV': 'Divorce', 'MILI': 'Military'}
val = lambda n, t: (get(n, t) or {'val': ''})['val'].strip()
raw = {}
for P, pre in ((WP, 'W'), (KP, 'K')):
    for i, v in P.items():
        if i in drop or i in MAP: continue
        n = nm(v); given = n.split('/')[0].strip(); sur = (n.split('/') + ['', ''])[1].strip()
        evs = [{'t': EV[c['tag']], 'tag': c['tag'], 'date': val(c, 'DATE'), 'place': val(c, 'PLAC'), 'note': c['val'][:80] if c['tag'] == 'OCCU' else ''}
               for c in v['ch'] if c['tag'] in EV]
        raw[i] = {'given': given, 'surname': sur, 'sex': val(v, 'SEX') if get(v, 'SEX') else '', 'events': evs, 'parents': [], 'spouses': [], 'children': []}
fix = lambda x: MAP.get(x, x)
for F, pre in ((WF, 'W'), (KF, 'K')):
    for f, v in F.items():
        hw = [fix(pre + c['val']) for c in v['ch'] if c['tag'] in ('HUSB', 'WIFE')]
        ch = [fix(pre + c['val']) for c in v['ch'] if c['tag'] == 'CHIL']
        if pre == 'W' and any(x in drop for x in hw): continue
        if pre == 'K' and all(x.startswith('W') for x in hw + ch): continue
        par = [x for x in hw if x in raw]
        for p in par:
            raw[p]['spouses'] += [q for q in par if q != p and q not in raw[p]['spouses']]
            raw[p]['children'] += [c for c in ch if c in raw and c not in raw[p]['children']]
        for c in ch:
            if c in raw: raw[c]['parents'] += [p for p in par if p not in raw[c]['parents']]
        for e in gets(v, 'MARR'):
            for p in par: raw[p]['events'].append({'t': 'Married', 'tag': 'MARR', 'date': val(e, 'DATE'), 'place': val(e, 'PLAC'), 'note': '', 'with': [q for q in par if q != p]})

def yr(d):
    m = re.findall(r'\b(\d{4})\b', d or ''); return int(m[0]) if m else None
est = {}
for i, p in raw.items():
    b = next((yr(e['date']) for e in p['events'] if e['tag'] in ('BIRT', 'CHR', 'BAPM') and yr(e['date'])), None)
    if b: est[i] = b
for _ in range(6):
    for i, p in raw.items():
        if i in est: continue
        c = [est[x] for x in p['children'] if x in est]; pa = [est[x] for x in p['parents'] if x in est]; sp = [est[x] for x in p['spouses'] if x in est]
        if c: est[i] = min(c) - 28
        elif pa: est[i] = max(pa) + 28
        elif sp: est[i] = sp[0]
for i, p in raw.items():
    dead = any(e['tag'] in ('DEAT', 'BURI', 'PROB') for e in p['events'])
    p['living'] = (not dead) and (est.get(i) is None or est[i] >= PRIV['living_if_born_after'])
def ahn(root, tag):
    q = [(root, 1)]
    while q:
        x, n = q.pop()
        raw[x].setdefault('ahn', {})[tag] = n
        q += [(par, 2 * n + (1 if raw[par]['sex'] == 'F' else 0)) for par in raw[x]['parents']]
ahn(KRISTIN, 'K'); ahn(MICHAEL, 'M')

full = lambda p: (p['given'] + ' ' + p['surname']).strip()
def rel(n, sex, who):
    g = int(math.log2(n))
    if g == 0: return None
    base = {'M': 'father', 'F': 'mother'}.get(sex, 'parent') if g == 1 else {'M': 'grandfather', 'F': 'grandmother'}.get(sex, 'grandparent')
    if g <= 2: return f"{who}'s {base}"
    k = g - 2
    return f"{who}'s {'great-' if k == 1 else str(k) + ('nd' if k == 2 else 'rd' if k == 3 else 'th') + ' great-'}{base}"
PREC_OK = {'city', 'manual', 'county', 'state', 'country'}
people = {}
for i, p in raw.items():
    o = {'id': i, 'sex': p['sex'], 'parents': p['parents'], 'children': p['children'], 'spouses': p['spouses'], 'living': p['living'], 'surname': p['surname']}
    if p['living']:
        o['name'] = 'Living ' + (p['surname'] or 'relative').split(' Or ')[0].split(' or ')[0]
    else:
        o['name'] = full(p) or 'Unknown'
        b = next((e for e in p['events'] if e['tag'] in ('BIRT', 'CHR', 'BAPM')), None); d = next((e for e in p['events'] if e['tag'] in ('DEAT', 'BURI')), None)
        by, dy = (yr(b['date']) if b else None), (yr(d['date']) if d else None)
        o['years'] = f"{by or '?'}–{dy or '?'}" if (by or dy) else ''
        a = p.get('ahn', {})
        if 'K' in a: o.update(rel=rel(a['K'], p['sex'], 'Kristin'), ahn=a['K'], side='W')
        elif 'M' in a: o.update(rel=rel(a['M'], p['sex'], 'Michael'), ahn=a['M'], side='K')
        evs, seen = [], set()
        for e in p['events']:
            if not e['date'] and not e['place']: continue
            key = (e['t'], e['date'], e['place'])
            if key in seen: continue
            seen.add(key)
            ev = {'t': e['t'], 'date': e['date'], 'place': e['place']}
            if e['note']: ev['note'] = e['note']
            w = [x for x in e.get('with', []) if x in raw and not raw[x]['living']]
            if w: ev['with'] = w[0]
            g = geocode(e['place']) if e['place'] else None
            if g: ev['ll'] = [round(g[0], 4), round(g[1], 4)]; ev['prec'] = g[2]
            elif e['place']: report.append(f'  unmapped place: {e["place"][:80]}')
            evs.append(ev)
        o['events'] = evs
    o.setdefault('side', 'K' if i.startswith('K') else 'W')
    people[i] = o
EXTRA = cfg('person_extras.json')
for nmx, ex in EXTRA.items():
    if nmx.startswith('_'): continue
    for i, p in raw.items():
        if full(p) == nmx and not p['living']:
            o = people[i]
            if ex.get('aka'): o['aka'] = ex['aka']
            if ex.get('note'): o['note'] = ex['note']
            o['events'] = o.get('events', []) + ex.get('events', [])
            if any(e['t'] == 'Died' for e in ex.get('events', [])):
                dy = next(yr(e['date']) for e in ex['events'] if e['t'] == 'Died')
                o['years'] = o['years'].split('–')[0] + '–' + str(dy)
# relatives off the direct line: brothers, sisters, aunts, uncles, great-uncles ...
def side_rel(g, sex, who):
    if g == 0: return f"{who}'s " + {'M': 'brother', 'F': 'sister'}.get(sex, 'sibling')
    base = {'M': 'uncle', 'F': 'aunt'}.get(sex, 'aunt or uncle')
    if g == 1: return f"{who}'s {base}"
    k = g - 1
    return f"{who}'s " + ('great-' if k == 1 else str(k) + ('nd' if k == 2 else 'rd' if k == 3 else 'th') + ' great-') + base
for i, o in people.items():
    if o.get('ahn') or o['living']: continue
    sib = [c for par in o['parents'] if par in people and people[par].get('ahn') for c in people[par]['children'] if c != i and c in people and people[c].get('ahn')]
    if sib:
        s0 = people[sib[0]]
        o['rel'] = side_rel(int(math.log2(s0['ahn'])), o['sex'], 'Kristin' if s0['side'] == 'W' else 'Michael')
        o['sibOf'] = sib[0]
living = [p for p in raw.values() if p['living']]
note(f'People: {len(people)} ({len(living)} living, shown without details)')

byname = {}
for i, p in raw.items(): byname.setdefault(full(p), []).append(i)
def resolve(n):
    if n in raw: return None if raw[n]['living'] else n   # a tree id (for people who share a name)
    L = sorted(byname.get(n, []), key=lambda i: 0 if raw[i].get('ahn') else 1)
    return L[0] if L and not raw[L[0]]['living'] else None

# ---------- stories ----------
import markdown
def md(t):
    t = re.sub(r'&#91;image:.*?\\?\]\s*', '', t)
    for a, b in PRIV['scrub']: t = re.sub(a, b, t)
    return markdown.markdown(t)
S = split(os.path.join(SRC, 'white-stories-family-copy.md'), 'W') + split(os.path.join(SRC, 'karman-stories.md'), 'K')
anc = [i for i, p in raw.items() if p.get('ahn') and not p['living']]
stories, problems = [], []
# side quests excerpted from a longer story: stories.json entry with "from" (source title), "start" and optional "end" (paragraph openings)
_slug = lambda t: 's' + re.sub(r'[^a-z0-9]+', '-', t.lower())[:40].strip('-')
for qt, qc in STORY_CFG.items():
    if not qc.get('from'): continue
    src = next((x for x in S if x['title'] == qc['from']), None)
    if not src: problems.append(f'side quest "{qt}": source story "{qc["from"]}" not found'); continue
    paras = src['body'].split('\n\n')
    i0 = next((k for k, p in enumerate(paras) if p.strip().startswith(qc['start'])), None)
    if i0 is None: problems.append(f'side quest "{qt}": start text not found in "{qc["from"]}"'); continue
    i1 = len(paras) if qc.get('end') == '$' else next((k for k, p in enumerate(paras) if k > i0 and qc.get('end') and p.strip().startswith(qc['end'])), None)
    body = '\n\n'.join(([qc['intro']] if qc.get('intro') else []) + paras[i0:i1 if i1 is not None else i0 + 1])
    body += f'\n\n*This side quest comes from the family story <a data-story="{_slug(src["title"])}">{src["title"]}</a>.*'
    S.append({'title': qt, 'body': body, 'group': 'Side quests', 'side': src['side'], 'level': 3})
for n, s in enumerate(S):
    if s['level'] != 3 or s['title'] in PRIV['excluded_story_titles']: continue
    sid = 's' + re.sub(r'[^a-z0-9]+', '-', s['title'].lower())[:40].strip('-')
    c = STORY_CFG.get(s['title'])
    text = s['title'] + ' ' + s['body']
    if c:
        ids = [r for r in (resolve(x) for x in c['people']) if r]
        places = [{'label': l, 'll': [a, b]} for l, a, b in c['places']]
    else:  # new story: link people named in it, pin at their birthplaces
        ids = []
        for i in anc:
            g = raw[i]['given'].split()[0] if raw[i]['given'] else ''
            if g and raw[i]['surname'] and re.search(r'\b' + re.escape(g) + r'\b.{0,25}\b' + re.escape(raw[i]['surname']) + r'\b', text): ids.append(i)
        places, seen = [], set()
        for i in ids:
            e = next((e for e in people[i].get('events', []) if e.get('ll') and e['t'] in ('Born', 'Christened', 'Baptized')), None)
            if e and e['place'] not in seen: seen.add(e['place']); places.append({'label': e['place'], 'll': e['ll']})
        note(f'NEW story (auto-linked, check it): "{s["title"]}" -> people: {", ".join(full(raw[i]) for i in ids) or "none"}; pins: {len(places)}')
    html = md(s['body'])
    plain = re.sub('<.*?>', '', html)
    for t in PRIV['forbidden_terms']:
        if re.search(re.escape(t), plain, re.I): problems.append(f'forbidden term "{t}" in story "{s["title"]}"')
    for p in living:
        if p['given'] and p['surname'] and len(p['given'].split()[0]) > 2 and re.search(re.escape(p['given'].split()[0]) + r'\W+(\w+\W+)?' + re.escape(p['surname'].split()[0]) + r'\b', plain):
            problems.append(f'living person "{full(p)}" named in story "{s["title"]}"')
    st = {'id': sid, 'title': s['title'], 'group': s['group'], 'side': s['side'], 'html': html, 'people': ids, 'places': places, 'photos': []}
    if c and c.get('quest'): st['quest'] = c['quest']
    stories.append(st)
for t in STORY_CFG:
    if not any(s['title'] == t for s in stories) and t not in PRIV['excluded_story_titles']:
        note(f'Story in stories.json no longer in the docs (renamed?): "{t}"')
note(f'Stories: {len(stories)}')

# ---------- photos ----------
from PIL import Image, ImageOps
os.makedirs(os.path.join(OUT, 'img/full'), exist_ok=True); os.makedirs(os.path.join(OUT, 'img/thumb'), exist_ok=True)
def crop_photo(im, box):
    """Crop to box (percent l,t,r,b), then trim flat black/white/gray bars left at the edges."""
    if not box: return im
    w, h = im.size
    im = im.crop((int(w * box[0] / 100), int(h * box[1] / 100), int(w * box[2] / 100), int(h * box[3] / 100)))
    g = im.convert('L'); w, h = g.size; px = g.load()
    def flat(vals):
        m = sum(vals) / len(vals)
        return sum((v - m) ** 2 for v in vals) / len(vals) < 40
    row = lambda y: [px[x, y] for x in range(0, w, 3)]
    col = lambda x: [px[x, y] for y in range(0, h, 3)]
    t, b, l, r = 0, h - 1, 0, w - 1
    while t < h * 0.3 and flat(row(t)): t += 1
    while b > h * 0.7 and flat(row(b)): b -= 1
    while l < w * 0.3 and flat(col(l)): l += 1
    while r > w * 0.7 and flat(col(r)): r -= 1
    return im.crop((l, t, r + 1, b + 1))
photos, used = [], set()
for n, c in enumerate(PHOTO_CFG):
    f = os.path.join(PROJ, c['file']); used.add(os.path.normpath(f))
    if not os.path.exists(f): note(f'Photo missing: {c["file"]}'); continue
    base = re.sub(r'[^a-z0-9-]', '-', os.path.splitext(os.path.basename(f))[0].lower())[:70]
    fp, tp = f'img/full/{base}.jpg', f'img/thumb/{base}.jpg'
    if True:  # always regenerate (crops may change)
        im = crop_photo(ImageOps.exif_transpose(Image.open(f)).convert('RGB'), c.get('crop'))
        big = im.copy(); big.thumbnail((1400, 1400)); big.save(os.path.join(OUT, fp), quality=82)
        ImageOps.fit(im, (160, 160), centering=(0.5, 0.3)).save(os.path.join(OUT, tp), quality=80)
    import hashlib
    ver = hashlib.md5(open(os.path.join(OUT, fp), 'rb').read()).hexdigest()[:8]
    ph = {'id': 'p%02d' % n, 'src': fp + '?v=' + ver, 'thumb': tp + '?v=' + ver, 'caption': c['caption'], 'people': [r for r in (resolve(x) for x in c['people']) if r], 'kind': c['kind']}
    if c.get('place'): ph['ll'] = c['place'][:2]; ph['place'] = c['place'][2]
    st = next((s for s in stories if s['title'] == c.get('story')), None)
    if st: ph['story'] = st['id']; st['photos'].append(ph['id'])
    photos.append(ph)
note(f'Photos: {len(photos)}')
for f in sorted(glob.glob(os.path.join(AUD, 'documents/photos/**/*.*'), recursive=True)):
    if f.lower().endswith(('.jpg', '.jpeg', '.png')) and os.path.normpath(f) not in used and not any('/' + d + '/' in f for d in PRIV['skip_photo_folders']) and os.path.basename(f) not in PRIV.get('skip_photos', []):
        note(f'Photo not on the site yet (add to photos.json?): {os.path.relpath(f, PROJ)}')

for o in people.values():
    o['stories'] = [s['id'] for s in stories if o['id'] in s['people']]
    o['photos'] = [p['id'] for p in photos if o['id'] in p['people']]
if problems:
    for p in problems: note('PRIVACY STOP: ' + p)
    sys.exit('Build stopped: fix the privacy problems above (privacy.json scrub/exclude), then run again.')
data = {'people': people, 'stories': stories, 'photos': photos, 'roots': {'W': KRISTIN, 'K': MICHAEL}}
os.makedirs(os.path.join(OUT, 'data'), exist_ok=True)
json.dump(data, open(os.path.join(OUT, 'data/family.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
unm = [r for r in report if r.startswith('  unmapped')]
note(f'Unmapped places (no pin): {len(set(unm))}. Add them to place_overrides.json if they matter.')
with open(os.path.join(PROJ, 'family-map-site', 'last-build-report.md'), 'w') as fh:
    fh.write('# Family map: last build report\n\n' + '\n'.join(r for r in report if not r.startswith('  unmapped')) + '\n\n## Unmapped places\n' + '\n'.join(sorted(set(unm))) + '\n')
print('OK: data/family.json written')
