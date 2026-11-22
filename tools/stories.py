import re, json, unicodedata
def split(path, side):
    txt=open(path).read()
    out=[]; grp=None; cur=None
    for line in txt.split('\n'):
        if line.startswith('## '):
            grp=line[3:].strip(); cur=None
            out.append({'title':grp,'group':grp,'level':2,'body':[],'side':side}); cur=out[-1]; continue
        if line.startswith('### '):
            out.append({'title':line[4:].strip(),'group':grp,'level':3,'body':[],'side':side}); cur=out[-1]; continue
        if cur is not None: cur['body'].append(line)
    for s in out:
        s['body']='\n'.join(s['body']).strip()
    return out
