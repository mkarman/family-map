import json, re, unicodedata
import os
GEO=os.environ.get('FAMILY_MAP_GEO','/mnt/project-files/family-map-site/geo')
CITIES=json.load(open(os.path.join(GEO,'cities.json')))
US=json.load(open(os.path.join(GEO,'uscounties.json')))
ABBR={'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California','CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming','DC':'District of Columbia'}
ST2AB={v.lower():k for k,v in ABBR.items()}
EXTRA_ST={'va':'VA','n.c.':'NC','ky':'KY','in.':'IN','in':'IN','tn':'TN','ga':'GA','mo':'MO','md':'MD','pa':'PA','nj':'NJ','co':'CO','ar':'AR','ny':'NY','oh':'OH'}
COUNTRY={'germany':'DE','deutschland':'DE','prussia':'DE','preußen':'DE','baden':'DE','bavaria':'DE','bayern':'DE','westfalen':'DE','saxony':'DE','oldenburg':'DE','niedersachsen':'DE','baden-württemberg':'DE','nordrhein-westfalen':'DE','england':'GB','wales':'GB','scotland':'GB','great britain':'GB','united kingdom':'GB','uk':'GB','ireland':'IE','france':'FR','netherlands':'NL','switzerland':'CH','czech republic':'CZ','bohemia':'CZ','austria':'AT','canada':'CA','canada west (ontario)':'CA','ontario':'CA','upper canada':'CA'}
CCENT={'DE':[51.2,10.4],'GB':[52.5,-1.5],'IE':[53.2,-8.0],'FR':[46.6,2.4],'NL':[52.2,5.5],'CH':[46.8,8.2],'CZ':[49.8,15.5],'AT':[47.6,14.1],'CA':[44.0,-79.4],'US':[39.5,-98.4]}
def norm(s):
    s=unicodedata.normalize('NFKD',s.lower()); s=''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9 ]','',s.replace('-',' ').replace('st.','saint').replace('st ','saint ')).strip()
IDX={}
for c in CITIES:
    IDX.setdefault((norm(c[0]),c[1]),[]).append(c)
OVR=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'place_overrides.json')))
SUB={'Auraria':[34.457,-84.019],'Nimburg':[48.110,7.776],'Teningen':[48.129,7.811],'Bahlingen':[48.121,7.740],'Riverside Cem':[39.785,-104.963],'Pinon, Pueblo':[38.43,-104.60],'Piñon':[38.43,-104.60],'Roselawn Cem':[38.236,-104.587],'Fulks Run':[38.645,-78.913],'Aynho':[51.996,-1.240]}
JUNK=re.compile(r'(cemetery|cemetary|cem\.|church|meeting|ward|district|precinct|tract|subdivision|same |street|parish|hundred|http|memorial|unknown|probated|^of\b|^\d)',re.I)
def city(tok,cc,adm=None):
    tok=re.sub(r'\(.*?\)','',tok); k=(norm(re.sub(r'\b(city|town|village|township|twp|am kaiserstuhl)\b','',tok,flags=re.I).strip()),cc)
    L=IDX.get(k,[])
    if adm: L=[c for c in L if c[2]==adm]
    if L: c=max(L,key=lambda c:c[3]); return [c[4],c[5]]
def geocode(p):
    if not p: return None
    p=p.strip()
    if len(p)>100: return None
    if p in OVR: return OVR[p] and [OVR[p][0],OVR[p][1],'manual']
    for k,v in SUB.items():
        if k.lower() in p.lower(): return v+['manual']
    toks=[t.strip() for t in re.split(r',',p) if t.strip()]
    toks=[t for t in toks if not re.search(r'united states|^usa$|^us$|colonial america|british america|present usa|verenigde staten|^america$',t,re.I)]
    # US state
    st=None; si=None
    for i in range(len(toks)-1,-1,-1):
        t=toks[i].lower().replace(' colony','').replace('colony of ','').replace('province of ','').replace(' territory','').strip()
        t=re.sub(r' \d{5}$','',t)
        if t in ST2AB: st=ST2AB[t]; si=i; break
        if t.upper() in ABBR and len(t)==2: st=t.upper(); si=i; break
        if t in EXTRA_ST: st=EXTRA_ST[t]; si=i; break
    if st:
        sname=ABBR[st]
        for t in toks[:si]:
            if JUNK.search(t): continue
            if re.search(r'\b(county|co\.?)$',t,re.I): continue
            r=city(t,'US',st)
            if r: return r+['city']
        for t in reversed(toks[:si]):
            cn=re.sub(r'\s*(county|co\.?|co)$','',t,flags=re.I).strip()
            cn=re.sub(r'\s*\(independent city\)','',cn,flags=re.I).replace('St ','St. ')
            for k in [sname+'|'+cn, sname+'|'+cn.replace('Saint','St.')]:
                if k in US['counties']: return US['counties'][k]+['county']
        return US['states'][sname]+['state']
    cc=None
    for t in reversed(toks):
        if t.lower() in COUNTRY: cc=COUNTRY[t.lower()]; break
    if cc:
        for t in toks:
            if JUNK.search(t): continue
            r=city(t,cc)
            if r: return r+['city']
        return CCENT[cc]+['country']
    return None
