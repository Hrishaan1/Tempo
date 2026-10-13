/*  Tempo → Apple Calendar UI.
 *
 *  Drives the subscription controls in Settings: creating / revoking a
 *  per-user, revocable bearer link and showing concise Apple Calendar setup
 *  steps. The plaintext token is only ever returned once by the
 *  createAppleCalendarToken callable; we cache it in this device's
 *  localStorage so the owner can copy it again, and store only its hash in
 *  Firestore.
 */
window.TempoCalendar = (function () {
  'use strict';

  var STORE = 'tempo.applecal.v1';
  var API_BASE = window.TEMPO_CALENDAR_API_BASE ||
    ((typeof location !== 'undefined' && location.origin) ? location.origin : '');

  var uid = null;
  var configured = false;
  var checked = false;

  function $(s) { return document.querySelector(s); }
  function fb() { return window.TempoFirebase; }

  function cachedToken() {
    try { return localStorage.getItem(STORE) || null; } catch (e) { return null; }
  }
  function setCachedToken(token) {
    try { token ? localStorage.setItem(STORE, token) : localStorage.removeItem(STORE); } catch (e) {}
  }

  function feedUrl(token) {
    if (!API_BASE) return null;
    return API_BASE + '/api/appleCalendarFeed?token=' + encodeURIComponent(token);
  }

  function note(msg) { var el = $('#appleCalNote'); if (el) el.textContent = msg || ''; }

  function setBusy(on) {
    ['#appleCalPrimary', '#appleCalRevoke', '#appleCalCopy', '#appleCalSignIn'].forEach(function (sel) {
      var el = $(sel);
      if (el) el.disabled = on;
    });
  }

  function apiPost(path) {
    var f = fb();
    if (!f || typeof f.getIdToken !== 'function') return Promise.reject(new Error('Cloud sync isn’t available right now.'));
    return f.getIdToken().then(function (token) {
      if (!token) throw new Error('Sign in with Google to continue.');
      return fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: '{}',
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error((data && data.error) || ('Request failed (' + res.status + ').'));
        return data;
      });
    });
  }

  function firestore() {
    try {
      if (typeof firebase !== 'undefined' && typeof firebase.firestore === 'function') return firebase.firestore();
    } catch (e) {}
    return null;
  }

  function refreshStatus(done) {
    var f = fb();
    uid = f && typeof f.getUid === 'function' ? f.getUid() : null;
    if (!uid) { configured = false; checked = true; render(); if (done) done(); return; }
    var db = firestore();
    if (!db) { render(); if (done) done(); return; }
    db.collection('users').doc(uid).collection('integrations').doc('appleCalendar').get()
      .then(function (snap) {
        var data = snap.exists ? snap.data() : null;
        configured = !!(data && data.active === true);
        checked = true;
        render();
        if (done) done();
      })
      .catch(function () { configured = false; checked = true; render(); if (done) done(); });
  }

  function createToken() {
    setBusy(true); note('');
    apiPost('/api/createAppleCalendarToken').then(function (data) {
      var token = data && data.token;
      if (!token) throw new Error('The server didn’t return a link.');
      setCachedToken(token);
      configured = true;
      render();
      note('Link ready — copy it into Apple Calendar below.');
    }).catch(function (err) {
      note((err && err.message) ? err.message : 'Couldn’t create a link. Please try again.');
    }).finally(function () { setBusy(false); });
  }

  function revokeToken() {
    if (!window.confirm('Disable this subscription? Apple Calendar will stop updating.')) return;
    setBusy(true); note('');
    apiPost('/api/revokeAppleCalendarToken').then(function () {
      setCachedToken(null);
      configured = false;
      render();
      note('Subscription revoked. Create a new link whenever you’re ready.');
    }).catch(function (err) {
      note((err && err.message) ? err.message : 'Couldn’t revoke the link. Please try again.');
    }).finally(function () { setBusy(false); });
  }

  function copyUrl() {
    var input = $('#appleCalUrl');
    if (!input || !input.value) return;
    var url = input.value;
    function done() { note('Link copied — paste it into Apple Calendar.'); }
    function fallback() {
      input.removeAttribute('readonly');
      input.select();
      try { document.execCommand('copy'); } catch (e) {}
      input.setAttribute('readonly', 'readonly');
      done();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(fallback);
    } else {
      fallback();
    }
  }

  function render() {
    var status = $('#appleCalStatus');
    var help = $('#appleCalHelp');
    var wrap = $('#appleCalUrlWrap');
    var input = $('#appleCalUrl');
    var open = $('#appleCalOpen');
    var primary = $('#appleCalPrimary');
    var signin = $('#appleCalSignIn');
    var revoke = $('#appleCalRevoke');
    var settingsStatus = $('#appleCalSettingsStatus');
    if (!status) return;
    status.classList.remove('is-on');

    var token = cachedToken();
    var url = token ? feedUrl(token) : null;
    var signedIn = !!uid;

    function settings(text) { if (settingsStatus) settingsStatus.textContent = text; }

    if (!signedIn) {
      status.textContent = 'Not connected';
      help.textContent = 'Sign in with Google so your schedule lives in the cloud, then create a link.';
      wrap.hidden = true;
      if (open) open.hidden = true;
      primary.hidden = true;
      signin.hidden = false;
      revoke.hidden = true;
      settings('Subscribe to your Tempo plan in Apple Calendar.');
      return;
    }
    signin.hidden = true;

    if (!checked) {
      status.textContent = 'Checking…';
      help.textContent = '';
      wrap.hidden = true;
      if (open) open.hidden = true;
      primary.hidden = true;
      revoke.hidden = true;
      return;
    }

    if (configured && url) {
      status.classList.add('is-on');
      status.textContent = 'Connected';
      help.textContent = 'Your subscription is active. Copy the link below into Apple Calendar.';
      input.value = url;
      wrap.hidden = false;
      if (open) { open.href = url.replace(/^https:\/\//, 'webcal://'); open.hidden = false; }
      primary.hidden = true;
      revoke.hidden = false;
      settings('Connected — manage your subscription link.');
      return;
    }

    if (open) open.hidden = true;
    wrap.hidden = true;
    revoke.hidden = false;

    if (configured) {
      status.textContent = 'Active elsewhere';
      help.textContent = 'A link already exists. For safety it’s only shown where it was created — generate a new one here, and the old link stops working.';
      primary.hidden = false;
      primary.textContent = 'Generate a new link';
      settings('Connected — manage your subscription link.');
    } else {
      status.textContent = 'Not connected';
      help.textContent = 'Create a private link, then subscribe to it in Apple Calendar.';
      primary.hidden = false;
      primary.textContent = 'Create subscription link';
      revoke.hidden = true;
      settings('Subscribe to your Tempo plan in Apple Calendar.');
    }
  }

  function openSheet() {
    if (window.TempoApp && typeof window.TempoApp.show === 'function') {
      window.TempoApp.show('appleCalSheet', $('#appleCalButton'));
    }
    note('');
    render();
    refreshStatus();
  }

  function setupUI() {
    var openBtn = $('#appleCalButton');
    if (openBtn) openBtn.onclick = openSheet;
    var primary = $('#appleCalPrimary');
    if (primary) primary.onclick = createToken;
    var copy = $('#appleCalCopy');
    if (copy) copy.onclick = copyUrl;
    var revoke = $('#appleCalRevoke');
    if (revoke) revoke.onclick = revokeToken;
    var signin = $('#appleCalSignIn');
    if (signin) signin.onclick = function () { if (fb() && fb().signIn) fb().signIn(); };
  }

  function init() {
    setupUI();
    render();
  }

  function onAuthChanged(nextUid) {
    uid = nextUid || null;
    configured = false;
    checked = false;
    if (uid) refreshStatus(); else render();
  }

  return {
    init: init,
    onAuthChanged: onAuthChanged,
    refreshStatus: refreshStatus,
  };
})();
