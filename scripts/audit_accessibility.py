"""Limited source checks; not browser or JAWS certification."""
from pathlib import Path
from html.parser import HTMLParser
import json, re, hashlib
ROOT = Path(__file__).resolve().parents[1]
class Markup(HTMLParser):
    def __init__(self):
        super().__init__(); self.elements=[]
    def handle_starttag(self,tag,attrs):
        self.elements.append((tag,dict(attrs)))
def run():
    checks=[]; hashes={}
    for page in ['index','asana','slack','resources','components','downloads']:
        path=f'public/{page}.html'; text=(ROOT/path).read_text(encoding='utf-8')
        hashes[path]=hashlib.sha256(text.encode()).hexdigest()
        parser=Markup(); parser.feed(text); elements=parser.elements
        ids=[a['id'] for _,a in elements if 'id' in a]
        labels={a.get('for') for t,a in elements if t=='label'}
        for label in re.findall(r'<label\b[^>]*>(.*?)</label>',text,re.DOTALL):
            labels.update(re.findall(r'<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"',label))
        refs=[r for _,a in elements for k in ['aria-labelledby','aria-describedby'] for r in a.get(k,'').split()]
        values={
            'English language':any(t=='html' and a.get('lang')=='en' for t,a in elements),
            'Nonempty page title':bool(re.search(r'<title>[^<]+</title>',text)),
            'Controls labelled':all(a.get('id') in labels for t,a in elements if t in ['input','select','textarea']),
            'Unique IDs':len(ids)==len(set(ids)),
            'ARIA references resolve':all(r in ids for r in refs),
            'Skip link and main':any(t=='a' and a.get('href')=='#main' for t,a in elements) and any(t=='main' and a.get('id')=='main' for t,a in elements),
            'No positive tabindex':all(int(a.get('tabindex','0'))<=0 for _,a in elements),
            'Status and error regions':any(a.get('role')=='status' for _,a in elements) and any(a.get('role')=='alert' for _,a in elements),
            'Zoom unrestricted':'user-scalable=no' not in text and 'maximum-scale=1' not in text,
        }
        checks.extend({'page':page,'check':k,'result':'source-check-pass' if v else 'source-check-fail'} for k,v in values.items())
    return {
        'scope':'Six dashboard pages; limited static markup checks',
        'result':'Conformance not established; rendered browser and JAWS verification remain necessary',
        'file_hashes':hashes,'structural_source_checks':checks,
        'browser_automation':'Unavailable: browser testing connection could not be established',
        'axe_run':False,'jaws_run':False,
        'prior_findings_addressed':['Repeatable eight-hour session extension and ten-minute warning','Immediate task-heading focus before initial retrieval','Progress focus before disabling save controls','Long-word wrapping on main, buttons and task metadata'],
        'manual_checks_remaining':['JAWS names, roles, states, announcements and forms mode','Rendered keyboard navigation, Back/Forward, focus visibility and no traps','Live Slack OAuth, channel, DMs, replies, responses and files','Windows Explorer selection for live downloads','Zoom, reflow, text spacing, forced colors and target sizing','Delayed or failed requests, expiry warning/extension and draft recovery','Full applicable WCAG 2.2 A/AA review before any conformance claim'],
        'references':['https://www.w3.org/TR/WCAG22/','https://www.w3.org/WAI/ARIA/apg/'],
    }
if __name__=='__main__':
    report=run();(ROOT/'accessibility-audit.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    checks=report['structural_source_checks']
    print(json.dumps({'source_checks':len(checks),'passed':sum(c['result']=='source-check-pass' for c in checks),'result':report['result']}))
