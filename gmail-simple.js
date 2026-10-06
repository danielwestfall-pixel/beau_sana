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
  const focusChanged = new Map();
  let desired = new Map();
  const previousFocus = document.activeElement;
  const style = document.createElement('style');
  style.textContent = `
    [${attribute}="panel"], [${attribute}="action"] { display:none !important; }
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
    if (!changed.has(element)) {
      const property = value === 'header' ? 'visibility' : 'display';
      changed.set(element, {
        attributes: new Map([attribute, 'aria-hidden', 'inert', 'hidden'].map(name => [name, element.getAttribute(name)])),
        property, cssValue: element.style.getPropertyValue(property),
        cssPriority: element.style.getPropertyPriority(property)
      });
    }
    if (element.contains(document.activeElement)) inbox.focus();
    if (element.getAttribute(attribute) !== value) element.setAttribute(attribute, value);
    if (element.getAttribute('aria-hidden') !== 'true') element.setAttribute('aria-hidden', 'true');
    if (!element.hasAttribute('inert')) element.setAttribute('inert', '');
    if (value !== 'header' && !element.hasAttribute('hidden')) element.setAttribute('hidden', '');
    const property = changed.get(element).property;
    const cssValue = value === 'header' ? 'hidden' : 'none';
    if (element.style.getPropertyValue(property) !== cssValue || element.style.getPropertyPriority(property) !== 'important') {
      element.style.setProperty(property, cssValue, 'important');
    }
  }
  function restoreElement(element, original) {
    original.attributes.forEach((value, name) => {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    });
    if (original.cssValue) element.style.setProperty(original.property, original.cssValue, original.cssPriority);
    else element.style.removeProperty(original.property);
  }
  function reconcile() {
    changed.forEach((original, element) => {
      if (desired.has(element)) return;
      restoreElement(element, original);
      changed.delete(element);
    });
    desired.forEach((value, element) => remember(element, value));
    const hiddenFocus = new Set();
    const selector = 'a[href], button, input, select, textarea, iframe, [tabindex], [contenteditable="true"], [role="button"], [role="link"], [role="tab"]';
    desired.forEach((value, element) => {
      if (element.matches(selector)) hiddenFocus.add(element);
      element.querySelectorAll(selector).forEach(control => hiddenFocus.add(control));
    });
    focusChanged.forEach((original, control) => {
      if (hiddenFocus.has(control)) return;
      if (original === null) control.removeAttribute('tabindex');
      else control.setAttribute('tabindex', original);
      focusChanged.delete(control);
    });
    hiddenFocus.forEach(control => {
      if (!focusChanged.has(control)) focusChanged.set(control, control.getAttribute('tabindex'));
      if (control.getAttribute('tabindex') !== '-1') control.setAttribute('tabindex', '-1');
    });
  }
  function mark(element, value) {
    // Do not touch message content, attachment previews, compose windows, or the new controls.
    if (element === bar || bar.contains(element) ||
        element.closest('[role="main"], [role="dialog"]') ||
        element.querySelector('[role="main"], [role="dialog"]')) return;
    desired.set(element, value);
  }
  function simplifyMessageActions() {
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
    main.querySelectorAll('.gK [role="button"], .gK button, .gK [role="checkbox"][aria-label*="starred" i], .ams[role="link"], .ams [role="button"], .ams [role="link"], .ams button, .ams a, .ade[role="button"], .ade [role="button"], button[aria-label="Print all"], button[aria-label="In new window"], button[aria-label="More message options"]')
      .forEach(control => controls.add(control));
    controls.forEach(control => {
      // Do not filter reply editors, attachment controls, or email-body content.
      if (control.closest('[role="dialog"], .aoI, .ii, [contenteditable="true"]') ||
          (control.closest('.ip') && !control.matches('.ams[role="link"]'))) return;
      const label = (control.getAttribute('aria-label') || control.getAttribute('data-tooltip') ||
        control.getAttribute('title') || control.textContent || '').trim();
      const keep = /^(delete|reply|forward|newer|older|previous|next|back to inbox)(?:\s*\(|$)/i.test(label);
      if (!keep) desired.set(control, 'action');
    });
  }
  function simplify() {
    desired = new Map();
    document.querySelectorAll('[role="banner"]').forEach(element => mark(element, 'header'));
    // Gmail layout classes are fallbacks for panels without semantic landmarks.
    document.querySelectorAll('.aeN, .aUx, .bAw, .brC-brG, [role="navigation"], [role="complementary"][aria-label="Side panel"], .brC-dA-I-Jw, .inboxsdk__sidebar')
      .forEach(element => mark(element, 'panel'));
    document.querySelectorAll('.zA > td.apU, .T-KT').forEach(element => {
      if (!element.closest('.ii, [role="dialog"]')) desired.set(element, 'action');
    });
    simplifyMessageActions();
    reconcile();
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
      restoreElement(element, original);
    });
    focusChanged.forEach((original, control) => {
      if (original === null) control.removeAttribute('tabindex');
      else control.setAttribute('tabindex', original);
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
    attributeFilter:['aria-label', 'data-tooltip', 'title', 'class', 'style', 'aria-hidden', 'inert', 'hidden', 'tabindex'] });
  inbox.focus();
})();
