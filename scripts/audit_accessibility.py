"""Source-only accessibility checks; not a rendered-page WCAG certification."""
from pathlib import Path
from html.parser import HTMLParser
import json
import hashlib

ROOT = Path(__file__).resolve().parents[1]

class Markup(HTMLParser):
    def __init__(self):
        super().__init__()
        self.elements = []
    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))

def luminance(hex_color):
    channels = [int(hex_color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    linear = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in channels]
    return sum(v * w for v, w in zip(linear, (0.2126, 0.7152, 0.0722)))

def contrast(first, second):
    values = sorted([luminance(first), luminance(second)])
    return (values[1] + 0.05) / (values[0] + 0.05)

def run():
    paths = ['public/index.html', 'public/style.css', 'public/app.js', 'server.mjs']
    sources = {path: (ROOT / path).read_text(encoding='utf-8') for path in paths}
    html = sources['public/index.html']
    parser = Markup(); parser.feed(html)
    elements = parser.elements
    ids = [attrs['id'] for _, attrs in elements if 'id' in attrs]
    labels = {attrs.get('for') for tag, attrs in elements if tag == 'label'}
    controls = [(tag, attrs) for tag, attrs in elements if tag in ('input', 'textarea', 'select')]
    checks = []
    def record(name, criteria, passed, evidence):
        checks.append({'check': name, 'criteria': criteria, 'result': 'source-check-pass' if passed else 'source-check-fail', 'evidence': evidence})
    record('Page language', ['3.1.1'], any(tag == 'html' and attrs.get('lang') == 'en' for tag, attrs in elements), 'html lang=en')
    record('Initial page title', ['2.4.2'], '<title>Connect to Asana — BeauSana</title>' in html, 'Initial title in HTML; route titles reviewed in app.js')
    record('All input controls have explicit labels', ['1.3.1', '3.3.2', '4.1.2'], all(attrs.get('id') in labels for _, attrs in controls), f'{len(controls)} labeled inputs/selects/textareas')
    record('Unique static IDs', ['1.3.1', '4.1.2'], len(ids) == len(set(ids)), f'{len(ids)} unique IDs; this is not an obsolete 4.1.1 criterion check')
    references = [ref for _, attrs in elements for key in ('aria-labelledby', 'aria-describedby') for ref in attrs.get(key, '').split()]
    record('ARIA label/help references resolve', ['1.3.1', '4.1.2'], all(ref in ids for ref in references), f'{len(references)} referenced IDs resolve')
    record('Skip link and main landmark', ['2.4.1'], any(tag == 'a' and attrs.get('href') == '#main' for tag, attrs in elements) and any(tag == 'main' and attrs.get('id') == 'main' for tag, attrs in elements), 'Skip link points to focusable main')
    record('No positive tabindex in static markup', ['2.4.3'], all(int(attrs.get('tabindex', '0')) <= 0 for _, attrs in elements), 'Native DOM order; dynamic focus still needs browser verification')
    record('Status and error announcement semantics', ['4.1.3', '3.3.1'], any(attrs.get('role') == 'status' for _, attrs in elements) and any(attrs.get('role') == 'alert' for _, attrs in elements), 'Persistent status and alert regions; actual JAWS announcements not tested')
    record('No zoom restriction in viewport', ['1.4.4'], not any(tag == 'meta' and attrs.get('name') == 'viewport' and ('user-scalable=no' in attrs.get('content', '') or 'maximum-scale=1' in attrs.get('content', '')) for tag, attrs in elements), 'No maximum-scale or user-scalable restriction; 200% zoom not tested')
    record('Token field permits paste', ['3.3.8'], not any(word in sources['public/app.js'] for word in ('onpaste', "addEventListener('paste'", 'addEventListener("paste"')), 'No paste prevention or cognitive challenge in local authentication; Asana token creation is external')
    colors = [
        ('Body text', '#172c27', '#f6f8f5', 4.5),
        ('Body text on cards', '#172c27', '#ffffff', 4.5),
        ('Hint/footer text', '#495d53', '#f6f8f5', 4.5),
        ('Header secondary text', '#495d53', '#ffffff', 4.5),
        ('Links on page', '#125642', '#f6f8f5', 4.5),
        ('Task links on cards', '#125642', '#ffffff', 4.5),
        ('Primary button text', '#ffffff', '#215b46', 4.5),
        ('Secondary button text', '#215b46', '#ffffff', 4.5),
        ('Error text', '#821c1c', '#fff0ee', 4.5),
        ('Input border / white input', '#64786c', '#ffffff', 3),
        ('Input border / page', '#64786c', '#f6f8f5', 3),
        ('Focus ring / page', '#945b00', '#f6f8f5', 3),
        ('Focus ring / white', '#945b00', '#ffffff', 3),
    ]
    color_results = [{'element': name, 'foreground': fg, 'background': bg, 'ratio': round(contrast(fg, bg), 2), 'threshold': threshold, 'result': 'pass' if contrast(fg, bg) >= threshold else 'fail'} for name, fg, bg, threshold in colors]
    findings = [
        {'id': 'A11Y-001', 'classification': 'confirmed-source-failure', 'criteria': ['2.2.1'], 'severity': 'high', 'title': 'Eight-hour authentication limit has no adjustment or extension', 'evidence': 'server.mjs defines SESSION_TTL as eight hours, removes expired sessions and sets a matching cookie lifetime. There is no turn-off/adjust/extend control or advance warning.', 'recommendation': 'Offer a user-controlled session extension with advance warning and at least 20 seconds to respond, repeatable at least ten times, or allow adjustment/turn-off before the limit starts.'},
        {'id': 'A11Y-002', 'classification': 'source-risk-needs-browser-reproduction', 'criteria': ['2.4.3'], 'severity': 'medium', 'title': 'Failed initial task load can leave focus in a hidden view', 'evidence': "enterTasks hides the connection view via show('tasks'), but only loadTasks success moves focus to tasks-heading. Its catch branch does not move focus. Slow or failed retrieval after connecting has no immediate focus transfer.", 'recommendation': 'Move focus to the tasks heading immediately when changing views, independently of request success, and verify failure navigation with a keyboard.'},
        {'id': 'A11Y-003', 'classification': 'source-risk-needs-browser-reproduction', 'criteria': ['2.4.3', '2.4.7', '4.1.2'], 'severity': 'medium', 'title': 'Saving disables the focused action controls', 'evidence': 'saveAction disables the entire task-actions fieldset and reload button. Focus is restored only after the async operation finishes. Native details summaries remain interactive outside disabled form-control semantics.', 'recommendation': 'Use focus-preserving busy states with explicit activation guards, or move focus to a stable labeled progress element, then test Tab and Shift+Tab during a delayed save.'},
        {'id': 'A11Y-004', 'classification': 'source-risk-needs-browser-reproduction', 'criteria': ['1.4.10', '1.4.12'], 'severity': 'medium', 'title': 'Some dynamic strings have no long-word wrapping rule', 'evidence': 'Instruction, comment and heading text can wrap long words. Uploaded-file list items, project metadata in task-list paragraphs and recipient text in buttons do not explicitly do so.', 'recommendation': 'Verify long filenames, project names and recipient names at 320 CSS pixels and under text-spacing overrides; add wrapping where overflow is observed.'},
    ]
    return {
        'standard': 'WCAG 2.2 Level AA (includes Level A)',
        'scope': 'BeauSana local interface source; connect, task-list, task-details and action handlers',
        'result': 'Conformance not established; one confirmed source-level failure and three risks requiring browser reproduction',
        'browser_automation': 'Unavailable: privileged native pipe bridge is not available; browser-client is not trusted',
        'axe_run': False,
        'jaws_run': False,
        'live_server': 'HTTP 200 observed at http://127.0.0.1:4317/',
        'file_hashes': {path: hashlib.sha256(text.encode()).hexdigest() for path, text in sources.items()},
        'structural_source_checks': checks,
        'contrast_calculations': color_results,
        'findings': findings,
        'manual_checks_remaining': [
            'Keyboard-only connect/demo/list/details, Enter and Space activation, Tab/Shift+Tab order, no trap (2.1.1, 2.1.2, 2.4.3)',
            'JAWS names, roles, expanded/collapsed states, errors, validation and announcements (1.3.1, 3.3.1, 4.1.2, 4.1.3)',
            '200% text resize, 400% browser zoom/320 CSS-pixel reflow and text-spacing overrides (1.4.4, 1.4.10, 1.4.12)',
            'Rendered focus visibility and focus not obscured across scroll positions, including expanded forms (2.4.7, 2.4.11)',
            'Rendered target dimensions and spacing; account for inline-link exceptions (2.5.8)',
            'Delayed, failed and ambiguous save/upload responses, expired connection and draft recovery',
            'Review/correct/reverse actual changes to user-controlled data, particularly handoff (3.3.4)',
            'Dynamic Asana instructions/comments in other languages and lost rich-text relationships (1.3.1, 3.1.2)',
            'Forced-colors mode and browser-native controls including file picker',
            'Full applicable A/AA criterion review before any conformance claim; source checks do not establish overall compliance',
        ],
        'not_applicable_to_current_local_UI': ['Prerecorded/live media and audio criteria', 'Flashing/moving/auto-updating content criteria', 'Dragging, complex gestures and motion actuation', 'Hover-only content', 'Images of text'],
        'references': [
            'https://www.w3.org/TR/WCAG22/',
            'https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html',
            'https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html',
            'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html',
        ],
    }

if __name__ == '__main__':
    report = run()
    destination = ROOT / 'accessibility-audit.json'
    destination.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'result': report['result'], 'structural_checks': len(report['structural_source_checks']), 'structural_checks_passed': sum(c['result'] == 'source-check-pass' for c in report['structural_source_checks']), 'contrast': report['contrast_calculations'], 'report': str(destination)}, indent=2))
