/*  Tempo notifications — offline local reminders + optional Firebase push.  */
window.TempoNotifications = (function () {
  'use strict';

  var KEY = 'tempo.notify.v1';
  var NOTED_KEY = 'tempo.notified.v1';
  var HORIZON = 14;        /* days worth of scheduled reminders sent to the service worker */
  var MAX_TRIGGERS = 40;   /* Chromium stops showing scheduled notifications past ~100 */
  var CHECK_MS = 20000;    /* local reminder poll while Tempo is open */
  var DAY = 86400000;
  var MIN = 60000;

  var pad = function (n) { return String(n).padStart(2, '0'); };
  var dateKey = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var parseDate = function (k) { var p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  var todayKey = function () { return dateKey(new Date()); };
  var minsLabel = function (n) { var h = Math.floor(n / 60), m = n % 60; return (h % 12 || 12) + ':' + pad(m) + ' ' + (h >= 12 ? 'PM' : 'AM'); };

  var settings = loadSettings();
  var messaging = null;
  var currentUid = null;
  var debounce = null;

  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || 'null') || {};
      return { enabled: !!s.enabled, lead: Number(s.lead) >= 0 ? Number(s.lead) : 0 };
    } catch (e) { return { enabled: false, lead: 0 }; }
  }

  function saveSettings() {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {}
  }

  function supportsTriggers() {
    return typeof Notification !== 'undefined' &&
      'showTrigger' in Notification.prototype &&
      typeof self.TimestampTrigger !== 'undefined';
  }

  /* The service worker owns reminders on browsers that can schedule them ahead of time. */
  function swHandlesReminders() {
    return supportsTriggers() &&
      ('serviceWorker' in navigator) &&
      !!navigator.serviceWorker.controller;
  }

  function occurs(e, k) {
    if (e.date === k) return true;
    if (e.date > k || e.repeat === 'once') return false;
    if (e.excludedDates && e.excludedDates.indexOf(k) !== -1) return false;
    var a = parseDate(e.date), b = parseDate(k);
    return e.repeat === 'daily'
      || (e.repeat === 'weekdays' && b.getDay() > 0 && b.getDay() < 6)
      || (e.repeat === 'weekly' && a.getDay() === b.getDay());
  }

  function occurrencesForDay(k) {
    var app = window.TempoApp;
    if (!app || !app.getState()) return [];
    var events = app.getState().events || [];
    return events.filter(function (e) { return occurs(e, k); }).map(function (e) {
      var o = e.overrides && e.overrides[k];
      if (!o) return e;
      var r = Object.assign({}, e, o);
      if (o.start === undefined || o.end === undefined) { r.start = e.start; r.end = e.end; }
      if (o.title === undefined) r.title = e.title;
      r.id = e.id; r.date = e.date; r.repeat = e.repeat;
      return r;
    });
  }

  function occurrenceTime(k, start) {
    return parseDate(k).getTime() + start * MIN;
  }

  function computeTriggers(now) {
    var list = [];
    outer:
    for (var d = 0; d < HORIZON; d++) {
      var k = dateKey(new Date(Date.now() + d * DAY));
      var recs = occurrencesForDay(k);
      for (var i = 0; i < recs.length; i++) {
        var time = occurrenceTime(k, recs[i].start) - settings.lead * MIN;
        if (time <= now) continue;
        list.push({
          tag: 'tempo-' + recs[i].id + '-' + k,
          id: recs[i].id,
          title: recs[i].title,
          body: minsLabel(recs[i].start) + ' \u2013 ' + minsLabel(recs[i].end),
          time: time,
          icon: './favicon.svg',
          url: './'
        });
        if (list.length >= MAX_TRIGGERS) break outer;
      }
    }
    return list;
  }

  function syncTriggers() {
    var enabled = settings.enabled && typeof Notification !== 'undefined' && Notification.permission === 'granted';
    send({ type: 'TEMPO_TRIGGERS', enabled: enabled, triggers: enabled ? computeTriggers(Date.now()) : [] });
    checkDue();
  }

  function scheduleUpdate() {
    clearTimeout(debounce);
    debounce = setTimeout(function () {
      syncTriggers();
      if (currentUid) tokenMaintenance();
    }, 600);
  }

  function send(msg) {
    try {
      if (!('serviceWorker' in navigator)) return;
      if (navigator.serviceWorker.controller) { navigator.serviceWorker.controller.postMessage(msg); return; }
      navigator.serviceWorker.ready.then(function (reg) {
        if (reg.active) reg.active.postMessage(msg);
      }).catch(function () {});
    } catch (e) {}
  }

  /* ---- local reminder checker (open-app path on browsers without Notification Triggers) ---- */

  function markNotified(key) {
    var list = (function () { try { return JSON.parse(localStorage.getItem(NOTED_KEY) || '[]'); } catch (e) { return []; } })();
    if (list.indexOf(key) !== -1) return false;
    list.push(key);
    while (list.length > 500) list.shift();
    try { localStorage.setItem(NOTED_KEY, JSON.stringify(list)); } catch (e) {}
    return true;
  }

  function checkDue() {
    if (!settings.enabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (swHandlesReminders()) return; /* the service worker will handle it */
    var now = Date.now(), k = todayKey(), recs = occurrencesForDay(k);
    for (var i = 0; i < recs.length; i++) {
      var start = occurrenceTime(k, recs[i].start);
      var trig = start - settings.lead * MIN;
      if (now < trig || now > start + 2 * MIN) continue;
      var nk = recs[i].id + '|' + k + '|' + settings.lead;
      if (!markNotified(nk)) continue;
      try {
        new Notification(recs[i].title, {
          body: minsLabel(recs[i].start) + ' \u2013 ' + minsLabel(recs[i].end),
          icon: './favicon.svg',
          tag: 'tempo-' + recs[i].id + '-' + k
        });
      } catch (e) {}
    }
  }

  /* ---- Firebase push (FCM) ---- */

  function fcmAvailable() {
    try {
      return typeof firebase !== 'undefined' && !!window.TEMPO_FIREBASE_CONFIG && firebase.messaging && firebase.messaging().isSupported && firebase.messaging().isSupported();
    } catch (e) { return false; }
  }

  function setupMessaging() {
    if (messaging || !fcmAvailable()) return;
    try {
      messaging = firebase.messaging();
      messaging.onMessage(function (payload) {
        var d = payload && payload.data ? payload.data : {};
        var t = d.title || 'Tempo', b = d.body || '';
        if (window.TempoApp) window.TempoApp.toast(t + (b ? ': ' + b : ''));
      });
      messaging.onTokenRefresh(function () { tokenMaintenance(); });
    } catch (e) { messaging = null; }
  }

  function db() {
    try { return firebase.firestore(); } catch (e) { return null; }
  }

  function getTokenReg() {
    var p;
    try {
      p = ('serviceWorker' in navigator && navigator.serviceWorker.getRegistration)
        ? navigator.serviceWorker.getRegistration('./firebase-messaging-sw.js')
        : Promise.resolve(null);
    } catch (e) { p = Promise.resolve(null); }
    return p.then(function (reg) {
      return messaging.getToken({ vapidKey: (window.TEMPO_FIREBASE_CONFIG || {}).vapidKey || '', serviceWorkerRegistration: reg || undefined });
    });
  }

  function tokenMaintenance() {
    if (!messaging || !currentUid) return;
    var store = db();
    if (!store) return;
    var ref = store.collection('users').doc(currentUid);
    store.collection('users').doc(currentUid).collection('notificationSettings').doc('main').set({
      enabled: settings.enabled && Notification.permission === 'granted',
      lead: settings.lead
    }).catch(function () {});

    if (!(settings.enabled && Notification.permission === 'granted')) {
      removeFcmToken(ref);
      return;
    }
    var vapid = (window.TEMPO_FIREBASE_CONFIG && window.TEMPO_FIREBASE_CONFIG.vapidKey) || '';
    if (!vapid) { renderUI(); return; }
    getTokenReg().then(function (token) {
      if (!token) { renderUI(); return; }
      ref.set({ fcmTokens: { [token]: firebase.firestore.FieldValue.serverTimestamp() } }, { merge: true })
        .then(renderUI)
        .catch(renderUI);
    }).catch(renderUI);
  }

  function removeFcmToken(ref) {
    if (!messaging) return;
    var vapid = (window.TEMPO_FIREBASE_CONFIG || {}).vapidKey || '';
    if (!vapid) return;
    getTokenReg().then(function (token) {
      if (!token) return;
      ref.update({ ['fcmTokens.' + token]: firebase.firestore.FieldValue.delete() }).catch(function () {});
    }).catch(function () {});
  }

  /* ---- settings UI ---- */

  function renderUI() {
    var sw = document.getElementById('notifySwitch');
    var opts = document.getElementById('notifyOptions');
    if (sw) {
      sw.checked = !!settings.enabled;
      sw.disabled = typeof Notification === 'undefined';
    }
    if (opts) opts.hidden = !settings.enabled;
  }

  function requestPermission() {
    if (typeof Notification === 'undefined') {
      if (window.TempoApp) window.TempoApp.toast('Notifications aren\u2019t supported here.');
      return;
    }
    if (Notification.permission === 'granted') { enable(); return; }
    if (Notification.permission === 'denied') {
      if (window.TempoApp) window.TempoApp.toast('Notifications are blocked for this site in your browser settings.');
      renderUI();
      return;
    }
    var p;
    try { p = Notification.requestPermission(); } catch (e) {
      try { p = Promise.resolve(Notification.requestPermission(function () {})); } catch (e2) { p = Promise.resolve('denied'); }
    }
    Promise.resolve(p).then(function (r) {
      if (r === 'granted') enable();
      else {
        var sw = document.getElementById('notifySwitch');
        if (sw) sw.checked = false;
      }
      renderUI();
      syncTriggers();
    });
  }

  function enable() {
    settings.enabled = true;
    saveSettings();
    renderUI();
    syncTriggers();
    if (currentUid) tokenMaintenance();
  }

  function disable() {
    settings.enabled = false;
    saveSettings();
    renderUI();
    syncTriggers();
    if (currentUid) tokenMaintenance();
  }

  function setupUI() {
    var sw = document.getElementById('notifySwitch');
    var lead = document.getElementById('notifyLead');
    if (sw) {
      sw.onchange = function () {
        if (sw.checked) requestPermission();
        else disable();
      };
    }
    if (lead) {
      lead.value = String(settings.lead);
      lead.onchange = function () {
        settings.lead = Number(lead.value) || 0;
        saveSettings();
        syncTriggers();
        if (currentUid) tokenMaintenance();
      };
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') scheduleUpdate();
    });
    setInterval(checkDue, CHECK_MS);
    renderUI();
  }

  function init() {
    setupMessaging();
    setupUI();
    syncTriggers();
  }

  function onAuthChanged(uid) {
    currentUid = uid || null;
    if (uid) tokenMaintenance();
    else renderUI();
  }

  return {
    init: init,
    onAuthChanged: onAuthChanged,
    scheduleUpdate: scheduleUpdate,
    syncTriggers: syncTriggers,
    checkDue: checkDue,
    getSettings: function () { return settings; }
  };
})();