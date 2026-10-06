/* Gmail Simple: local, reversible UI toggle; no network or storage access. */
(() => {
  'use strict';
  if (location.hostname !== 'mail.google.com') {
    alert('Open Gmail first, then select Gmail Simple again.');
    return;
  }
  const key = '__beausanaGmailSimpleV1';
  if (window[key]) { window[key](); return; }
  const attribute = 'data-beausana-gmail-simple';
  const changed = new Map();
  const previousFocus = document.activeElement;
  const style = document.createElement('style');
  style.textContent = `
    [${attribute}="panel"], [${attribute}="action"] { display:none !important; }
    /* Gmail's app rail and message-star controls, including newly rendered rows. */
    .bAw, .zA > td.apU, .T-KT { display:none !important; }
    [${attribute}="header"], [${attribute}="header"] * { visibility:hidden !important; }
    #beausana-gmail-simple-bar {
      position:fixed; top:8px; left:12px; z-index:2147483647;
      display:flex; gap:12px; align-items:center; padding:6px;
      background:white; color:#111; border:2px solid #333; border-radius:6px;
      font:18px/1.3 Arial,sans-serif; max-width:calc(100vw - 40px);
    }
    #beausana-gmail-simple-bar a, #beausana-gmail-simple-bar button {
      font:inherit; color:#111; background:white; border:2px solid #333;
      border-radius:4px; padding:6px 12px; text-decoration:underline; cursor:pointer;
    }
    #beausana-gmail-simple-bar :focus-visible { outline:3px solid #005fcc; outline-offset:2px; }
    @media (forced-colors:active) {
      #beausana-gmail-simple-bar, #beausana-gmail-simple-bar a,
      #beausana-gmail-simple-bar button { background:Canvas; color:CanvasText; border-color:CanvasText; }
    }
  `;
  const bar = document.createElement('nav');
  bar.id = 'beausana-gmail-simple-bar';
  bar.setAttribute('aria-label', 'Simple Gmail controls');
  const inbox = document.createElement('a');
  inbox.href = '#inbox';
  inbox.textContent = 'Inbox';
  const restore = document.createElement('button');
  restore.type = 'button';
  restore.textContent = 'Show full Gmail';
  bar.append(inbox, restore);

  function remember(element, value) {
    if (!changed.has(element)) changed.set(element, element.getAttribute(attribute));
    if (element.getAttribute(attribute) !== value) element.setAttribute(attribute, value);
  }
  function mark(element, value) {
    // Do not touch message content, attachment previews, compose windows, or the new controls.
    if (element === bar || bar.contains(element) ||
        element.closest('[role="main"], [role="dialog"]') ||
        element.querySelector('[role="main"], [role="dialog"]')) return;
    remember(element, value);
  }
  function simplifyMessageActions() {
    // Restore old toolbar marks first: Gmail reuses controls when returning to the inbox.
    changed.forEach((original, element) => {
      if (element.getAttribute(attribute) !== 'action') return;
      if (original === null) element.removeAttribute(attribute);
      else element.setAttribute(attribute, original);
      changed.delete(element);
    });
    const main = Array.from(document.querySelectorAll('[role="main"]'))
      .find(element => element.getClientRects().length && element.querySelector('.adn'));
    if (!main) return;
    const controls = new Set();
    document.querySelectorAll('.G-atb').forEach(toolbar => {
      if (toolbar.getClientRects().length) {
        toolbar.querySelectorAll('[role="button"], button, a, [role="checkbox"]')
          .forEach(control => controls.add(control));
      }
    });
    main.querySelectorAll('.gK [role="button"], .gK button, .ams [role="button"], .ams [role="link"], .ams button, .ams a, .ade[role="button"], .ade [role="button"]')
      .forEach(control => controls.add(control));
    controls.forEach(control => {
      // Do not filter reply editors, attachment controls, or email-body content.
      if (control.closest('[role="dialog"], .ip, .aoI, .ii, [contenteditable="true"]')) return;
      const label = (control.getAttribute('aria-label') || control.getAttribute('data-tooltip') ||
        control.getAttribute('title') || control.textContent || '').trim();
      const keep = /^(delete|reply|forward|newer|older|previous|next|back to inbox)(?:\s*\(|$)/i.test(label);
      if (!keep) remember(control, 'action');
    });
  }
  function simplify() {
    document.querySelectorAll('[role="banner"]').forEach(element => mark(element, 'header'));
    // Gmail layout classes are fallbacks for panels without semantic landmarks.
    document.querySelectorAll('.aeN, .nH.aUx, .bAw, .brC-brG, [role="navigation"]')
      .forEach(element => mark(element, 'panel'));
    simplifyMessageActions();
  }
  let frame = 0;
  const observer = new MutationObserver(() => {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; simplify(); });
  });
  function undo() {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    const focusNeedsRestoring = bar.contains(document.activeElement);
    changed.forEach((original, element) => {
      if (original === null) element.removeAttribute(attribute);
      else element.setAttribute(attribute, original);
    });
    style.remove();
    bar.remove();
    delete window[key];
    if (focusNeedsRestoring && previousFocus && previousFocus.isConnected) previousFocus.focus();
  }
  restore.addEventListener('click', undo);
  window[key] = undo;
  document.head.append(style);
  document.body.append(bar);
  simplify();
  observer.observe(document.body, { childList:true, subtree:true, attributes:true,
    attributeFilter:['aria-label', 'data-tooltip', 'title', 'class', 'style'] });
  inbox.focus();
})();
