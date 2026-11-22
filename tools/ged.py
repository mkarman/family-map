import re, sys, json
def parse(path):
    recs={}; cur=None; stack=[]
    for line in open(path,encoding='utf-8-sig',errors='replace'):
        line=line.rstrip('\r\n')
        m=re.match(r'^(\d+) (@[^@]+@ )?(\S+) ?(.*)$',line)
        if not m: continue
        lvl=int(m.group(1)); xref=(m.group(2) or '').strip(); tag=m.group(3); val=m.group(4)
        node={'tag':tag,'val':val,'ch':[]}
        if lvl==0:
            cur=node; node['id']=xref; recs[xref or tag]=node; stack=[node]; continue
        while len(stack)>lvl: stack.pop()
        if tag in('CONC','CONT') and stack:
            p=stack[-1]; p['val']+=('\n' if tag=='CONT' else '')+val; continue
        stack[-1]['ch'].append(node); stack.append(node)
    return recs
def get(n,tag): 
    for c in n['ch']:
        if c['tag']==tag: return c
def gets(n,tag): return [c for c in n['ch'] if c['tag']==tag]
