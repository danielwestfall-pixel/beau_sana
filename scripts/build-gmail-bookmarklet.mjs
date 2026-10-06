import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync(new URL('../gmail-simple.js', import.meta.url), 'utf8');
const bookmarklet = 'javascript:' + encodeURIComponent(source);
writeFileSync(new URL('../gmail-bookmarklet.html', import.meta.url), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Install Gmail Simple</title><style>
body{font:20px/1.6 system-ui,sans-serif;max-width:780px;margin:40px auto;padding:0 24px;color:#171717;background:#fff}
a{color:#0645ad} a:focus-visible,textarea:focus-visible{outline:3px solid #005fcc;outline-offset:4px}
.bookmark{display:inline-block;padding:12px 20px;border:2px solid #333;border-radius:6px}
textarea{box-sizing:border-box;width:100%;height:130px;font-size:16px} li{margin:12px 0}
</style></head><body><main>
<h1>Gmail Simple</h1>
<p>Open Gmail first, then select this bookmark to apply the simple view.</p>
<p>A bookmark that hides Gmail's surrounding panels, the right-hand Calendar/Keep/Tasks/Contacts toolbar, and message stars. It adds <strong>Inbox</strong> and <strong>Show full Gmail</strong> controls, and leaves message lists, inbox category tabs, message navigation, attachment controls, and replies in Gmail.</p>
<p>If you installed an earlier version, replace your existing bookmark's URL with the code below, or delete the old bookmark and drag the updated link onto the bookmarks bar. Refresh Gmail before trying the updated bookmark.</p>
<p>In an open message, extra toolbar actions are hidden; Delete, Reply, Forward, and message navigation remain. Message text, attachment downloads, and the controls needed to write and send a reply remain available. Message-action filtering expects Gmail's English control labels.</p>
<h2>Install once</h2>
<p>Drag this link onto your browser's bookmarks bar:</p>
<p><a class="bookmark" href="${bookmarklet}">Gmail Simple</a></p>
<h2>Keyboard installation</h2>
<ol><li>Bookmark this page with Ctrl+D. Name the bookmark <strong>Gmail Simple</strong>.</li>
<li>Tab to the Bookmark code box below. Press Ctrl+A, then Ctrl+C.</li>
<li>Open your browser's bookmark manager, find Gmail Simple, and edit its URL. Replace the URL with the copied code and save.</li></ol>
<label for="code">Bookmark code</label>
<textarea id="code" readonly spellcheck="false">${bookmarklet}</textarea>
<h2>Use in Gmail</h2>
<ol><li>Open Gmail and select the Gmail Simple bookmark. Focus moves to the new Inbox link.</li>
<li>Refresh the JAWS virtual buffer with <strong>Insert+Esc</strong> in desktop keyboard layout, or <strong>Caps Lock+Esc</strong> in laptop keyboard layout. Hold Insert or Caps Lock and press Esc. Use this after hiding or restoring controls if JAWS still announces the previous view.</li>
<li>Use Inbox to return to your messages. Open messages, download attachments, and reply using Gmail's existing controls.</li>
<li>Select the bookmark again, or choose Show full Gmail, to restore the full interface. Refreshing also restores it.</li></ol>
<p>The JAWS shortcut refreshes its view without reloading Gmail. F5 or Ctrl+R reloads Gmail and removes the bookmarklet's changes; select the bookmark again afterward. See <a href="https://www.freedomscientific.com/training/jaws/hotkeys/">Freedom Scientific's JAWS keyboard shortcuts</a>.</p>
<p>Hidden panels and controls receive aria-hidden, inert, and inline hiding; their focusable controls are removed from the Tab sequence. Show full Gmail restores the original attributes. This is intended to remove the controls from screen-reader navigation as well as visually; verify with your JAWS setup. The bookmark does not change Gmail settings, send messages, read message contents, or contact another service. It applies only to the current tab until refresh.</p>
<p>Gmail can change its layout. This version has not been verified in a signed-in Gmail account or with JAWS; try it with his usual Gmail view before relying on it. If a panel remains, restore the full view and adjust the source for that layout.</p>
<p><a href="gmail-simple.js">Readable JavaScript source</a></p>
</main></body></html>`);
console.log('Created gmail-bookmarklet.html');
