import sys, json, re, os, math, hashlib
sys.path.insert(0,'/root/build')
import markdown
from geocode import geocode
from stories import split
from story_config import CFG
from photo_config import PHOTOS
from PIL import Image, ImageOps
OUT='/root/site'
P=json.load(open('/root/build/people_raw.json'))
def full(p): return (p['given']+' '+p['surname']).strip()
def yr(d):
    m=re.findall(r'\b(\d{4})\b',d or ''); return m[0] if m else ''
def rel(n,sex,who):
    if n==1: return None
    g=int(math.log2(n))
    base={'M':'father','F':'mother'}.get(sex,'parent') if g==1 else {'M':'grandfather','F':'grandmother'}.get(sex,'grandparent')
    if g<=2: return f"{who}'s {base}"
    k=g-2
    pre='great-' if k==1 else f"{k}{'nd' if k==2 else 'rd' if k==3 else 'th'} great-"
    return f"{who}'s {pre}{base}"
# name index for linking
byname={}
for i,p in P.items():
    byname.setdefault(full(p),[]).append(i)
def resolve(n):
    L=byname.get(n,[])
    L=sorted(L,key=lambda i:(0 if P[i].get('ahn') else 1))
    return L[0] if L else None
people={}
for i,p in P.items():
    o={'id':i,'sex':p['sex'],'parents':p['parents'],'children':p['children'],'spouses':p['spouses'],'living':p['living']}
    if p['living']:
        o['name']='Living '+((p['surname'] or 'relative').split(' Or ')[0].split(' or ')[0])
        o['surname']=p['surname']
    else:
        o['name']=full(p) or 'Unknown'; o['surname']=p['surname']
        b=next((e for e in p['events'] if e['tag'] in('BIRT','CHR','BAPM')),None); d=next((e for e in p['events'] if e['tag'] in('DEAT','BURI')),None)
        by=yr(b['date']) if b else ''; dy=yr(d['date']) if d else ''
        o['years']=(by or '?')+'–'+(dy or '?') if (by or dy) else ''
        a=p.get('ahn',{})
        if 'K' in a: o['rel']=rel(a['K'],p['sex'],'Kristin'); o['ahn']=a['K']; o['side']='W'
        elif 'M' in a: o['rel']=rel(a['M'],p['sex'],'Michael'); o['ahn']=a['M']; o['side']='K'
        evs=[]; seen=set()
        for e in p['events']:
            g=geocode(e['place']) if e['place'] else None
            if not e['date'] and not e['place']: continue
            key=(e['t'],e['date'],e['place'])
            if key in seen: continue
            seen.add(key)
            ev={'t':e['t'],'date':e['date'],'place':e['place']}
            if e.get('note') and e['tag']=='OCCU': ev['note']=e['note']
            if e.get('with'):
                w=[x for x in e['with'] if x in P and not P[x]['living']]
                if w: ev['with']=w[0]
            if g: ev['ll']=[round(g[0],4),round(g[1],4)]; ev['prec']=g[2]
            evs.append(ev)
        o['events']=evs
    people[i]=o
# side for non-ancestors: inherit
for i,o in people.items():
    if 'side' not in o: o['side']='K' if i.startswith('K') else 'W'
# stories
S=split('/root/work/white-stories.md','W')+split('/root/work/karman-stories.md','K')
stories=[]; unresolved=set()
SCRUB=[(r'among them Christopher, \*\*Timothy Michael\*\* \(born 21 April 1952\) and Stephen Douglas \(born 27 June 1958\)','among them Michael\'s father'),
 (r'Carter and children, Vicki and Christi','Carter and their children')]
def md(t):
    for a,b in SCRUB: t=re.sub(a,b,t)
    t=re.sub(r'&#91;image:.*?\\?\]\s*','',t)
    return markdown.markdown(t)
idx2sid={}
for i,(names,places) in CFG.items():
    s=S[i]; sid='s%d'%i; idx2sid[i]=sid
    ids=[]
    for n in names:
        r=resolve(n)
        if r and r not in ids and not P[r]['living']: ids.append(r)
        elif not r: unresolved.add(n)
    stories.append({'id':sid,'title':s['title'],'group':s['group'],'side':s['side'],'html':md(s['body']),'people':ids,'places':[{'label':l,'ll':[a,b]} for l,a,b in places],'photos':[]})
# group intros: attach intro html as lede
for s in stories:
    pass
# photos
os.makedirs(OUT+'/img/full',exist_ok=True); os.makedirs(OUT+'/img/thumb',exist_ok=True)
photos=[]
for n,(f,cap,names,loc,si,kind) in enumerate(PHOTOS):
    pid='p%02d'%n
    base=re.sub(r'[^a-z0-9-]','-',os.path.splitext(os.path.basename(f))[0].lower())[:70]
    im=Image.open(f); im=ImageOps.exif_transpose(im).convert('RGB')
    full_=im.copy(); full_.thumbnail((1400,1400)); full_.save(f'{OUT}/img/full/{base}.jpg',quality=82)
    th=ImageOps.fit(im,(160,160),centering=(0.5,0.3)); th.save(f'{OUT}/img/thumb/{base}.jpg',quality=80)
    ids=[]
    for nm in names:
        r=resolve(nm)
        if r and not P[r]['living']: ids.append(r)
        elif not r: unresolved.add(nm)
    ph={'id':pid,'src':f'img/full/{base}.jpg','thumb':f'img/thumb/{base}.jpg','caption':cap,'people':ids,'kind':kind}
    if loc: ph['ll']=[loc[0],loc[1]]; ph['place']=loc[2]
    if si is not None and si in idx2sid:
        ph['story']=idx2sid[si]; next(s for s in stories if s['id']==idx2sid[si])['photos'].append(pid)
    photos.append(ph)
for o in people.values():
    o['stories']=[s['id'] for s in stories if o['id'] in s['people']]
    o['photos']=[p['id'] for p in photos if o['id'] in p['people']]
roots={'W':'W@I500002@','K':'W@I500012@'}
data={'people':people,'stories':stories,'photos':photos,'roots':roots,'built':'2026-11-22'}
os.makedirs(OUT+'/data',exist_ok=True)
json.dump(data,open(OUT+'/data/family.json','w'),ensure_ascii=False,separators=(',',':'))
print('unresolved:',unresolved)
print(len(people),len(stories),len(photos), os.path.getsize(OUT+'/data/family.json'))
