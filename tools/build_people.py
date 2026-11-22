import sys, json, re
sys.path.insert(0,'/root/build')
from ged import parse, get, gets
from geocode import geocode
W=parse('/mnt/project-files/family-tree-audit/working-tree/white-family-tree-2026-11-19.ged')
K=parse('/mnt/project-files/family-tree-audit/karman-side/karman-family-tree-2026-11-19.ged')
def load(R,pre):
    P={};F={}
    for k,v in R.items():
        if v['tag']=='INDI': P[pre+v['id']]=v
        elif v['tag']=='FAM': F[pre+v['id']]=v
    return P,F
WP,WF=load(W,'W'); KP,KF=load(K,'K')
MAP={'K@I500001@':'W@I500026@','K@I500003@':'W@I500012@'}
# find Kristin & Christi in K
for k,v in KP.items():
    n=get(v,'NAME')['val']
    if n.startswith('Kristin'): MAP[k]='W@I500002@'
    if n.startswith('Christi'): MAP[k]=[w for w,x in WP.items() if get(x,'NAME')['val'].startswith('Christi Rebecca')][0]
def famc(P,F,pre,i): return [pre+c['val'] for c in gets(P[i],'FAMC')]
def parents_of(P,F,pre,i):
    out=[]
    for f in famc(P,F,pre,i):
        if f not in F: continue
        for c in F[f]['ch']:
            if c['tag'] in('HUSB','WIFE'): out.append(pre+c['val'])
    return out
# remove W ancestors above Timothy & Christi
drop=set(); stack=[]
for w in [MAP['K@I500001@'], [v for k,v in MAP.items() if 'Christi' in get(KP[k],'NAME')['val']][0]]:
    stack+=parents_of(WP,WF,'W',w)
while stack:
    x=stack.pop()
    if x in drop or x not in WP: continue
    drop.add(x); stack+=parents_of(WP,WF,'W',x)
print('dropping W ancestors',[get(WP[d],'NAME')['val'] for d in drop])
people={}; fams=[]
def year(d):
    m=re.findall(r'\b(\d{4})\b',d or ''); return int(m[0]) if m else None
EV={'BIRT':'Born','CHR':'Christened','BAPM':'Baptized','DEAT':'Died','BURI':'Buried','RESI':'Lived','CENS':'Census','IMMI':'Immigrated','EMIG':'Emigrated','NATU':'Naturalized','EVEN':'Event','OCCU':'Occupation','PROB':'Probate','RELI':'Religion','DIV':'Divorce','MILI':'Military'}
def add(P,pre):
    for i,v in P.items():
        if i in drop or i in MAP: continue
        nm=get(v,'NAME')['val']; given=nm.split('/')[0].strip(); sur=(nm.split('/')+['',''])[1].strip()
        evs=[]
        for c in v['ch']:
            if c['tag'] in EV:
                d=get(c,'DATE'); p=get(c,'PLAC'); t=get(c,'TYPE')
                evs.append({'t':EV[c['tag']],'tag':c['tag'],'date':d['val'].strip() if d else '','place':p['val'].strip() if p else '','note':(t['val'] if t else (c['val'] if c['tag']=='OCCU' else ''))[:80]})
        people[i]={'id':i,'given':given,'surname':sur,'sex':(get(v,'SEX') or {'val':''})['val'],'events':evs,'parents':[],'spouses':[],'children':[]}
add(WP,'W'); add(KP,'K')
def fix(x): return MAP.get(x,x)
for F,pre in [(WF,'W'),(KF,'K')]:
    for f,v in F.items():
        h=[fix(pre+c['val']) for c in v['ch'] if c['tag']=='HUSB']; w=[fix(pre+c['val']) for c in v['ch'] if c['tag']=='WIFE']
        ch=[fix(pre+c['val']) for c in v['ch'] if c['tag']=='CHIL']
        mem=[x for x in h+w+ch if x in people]
        if pre=='W' and any(x in drop for x in h+w): continue
        if pre=='K' and all(x.startswith('W') for x in h+w+ch): continue
        par=[x for x in h+w if x in people]
        for p in par:
            for q in par:
                if p!=q and q not in people[p]['spouses']: people[p]['spouses'].append(q)
            for c in ch:
                if c in people and c not in people[p]['children']: people[p]['children'].append(c)
        for c in ch:
            if c in people:
                for p in par:
                    if p not in people[c]['parents']: people[c]['parents'].append(p)
        for e in gets(v,'MARR'):
            d=get(e,'DATE'); pl=get(e,'PLAC')
            for p in par: people[p]['events'].append({'t':'Married','tag':'MARR','date':d['val'].strip() if d else '','place':pl['val'].strip() if pl else '','note':'','with':[q for q in par if q!=p]})
# birth year estimates
est={}
for i,p in people.items():
    for e in p['events']:
        if e['tag'] in('BIRT','CHR','BAPM') and year(e['date']): est[i]=year(e['date']); break
for _ in range(6):
    for i,p in people.items():
        if i in est: continue
        c=[est[x] for x in p['children'] if x in est]; pa=[est[x] for x in p['parents'] if x in est]; sp=[est[x] for x in p['spouses'] if x in est]
        if c: est[i]=min(c)-28
        elif pa: est[i]=max(pa)+28
        elif sp: est[i]=sp[0]
for i,p in people.items():
    dead=any(e['tag'] in('DEAT','BURI','PROB') for e in p['events'])
    p['living']= (not dead) and (est.get(i) is None or est[i]>=1915)
    p['est']=est.get(i)
# ahnentafel from Kristin & Michael
def ahn(root,tag):
    q=[(root,1)]; 
    while q:
        x,n=q.pop()
        people[x].setdefault('ahn',{})[tag]=n
        for par in people[x]['parents']:
            s=people[par]['sex']; q.append((par,2*n+(1 if s=='F' else 0)))
ahn('W@I500002@','K'); ahn('W@I500012@','M')
places=sorted({e['place'] for p in people.values() for e in p['events'] if e['place']})
json.dump(people,open('/root/build/people_raw.json','w'),indent=0,ensure_ascii=False)
json.dump(places,open('/root/build/places.json','w'),indent=0,ensure_ascii=False)
print(len(people),'people',sum(p['living'] for p in people.values()),'living',len(places),'places')
