/*  Tempo Firebase integration — optional, requires firebase-config.js  */
window.TempoFirebase = (function () {
  'use strict';

  let app = null, auth = null, db = null;
  let unsubscribe = null;
  let currentUser = null;
  let signingIn = false;

  function ready() {
    return typeof firebase !== 'undefined' && !!app;
  }

  function signInError(e) {
    if (e.code === 'auth/configuration-not-found')
      return 'Google sign-in is not enabled in this Firebase project. Enable it in the Firebase console under Authentication > Sign-in method.';
    if (e.code === 'auth/popup-closed-by-user') return '';
    if (e.code === 'auth/popup-blocked') return 'The sign-in popup was blocked. Please allow popups for this site and try again.';
    if (e.code === 'auth/cancelled-popup-request') return '';
    if (e.code === 'auth/unauthorized-domain') return 'This domain is not authorized for sign-in. Add it in the Firebase console under Authentication > Settings > Authorized domains.';
    if (e.code === 'auth/operation-not-allowed') return 'Google sign-in is not enabled. Enable it in the Firebase console under Authentication > Sign-in method.';
    return e.message || 'Sign-in failed.';
  }

  function loadScheduleFromCloud(onDone) {
    if (!ready() || !currentUser) return false;
    var ref = db.collection('users').doc(currentUser.uid).collection('schedule').doc('main');
    ref.get().then(function (snap) {
      if (!snap.exists) {
        if (onDone) onDone();
        return;
      }
      var cloud = snap.data();
      if (!Array.isArray(cloud.events) || !cloud.events.length) {
        if (onDone) onDone();
        return;
      }
      showMergeOptions(cloud, onDone);
    }).catch(function (e) {
      console.warn('Tempo: cloud load failed', e.code || e.message || e);
      if (e.code === 'permission-denied' || (e.message && e.message.includes('permission'))) {
        if (window.TempoApp) window.TempoApp.toast('Firestore permission denied. Deploy firestore.rules to your Firebase project.');
      } else {
        if (window.TempoApp) window.TempoApp.toast('Could not load cloud backup.');
      }
      if (onDone) onDone();
    });
  }

  function showMergeOptions(cloud, onDone) {
    var app = window.TempoApp;
    var sheet = document.getElementById('syncSheet');
    var msg = document.getElementById('syncMessage');
    var title = document.getElementById('syncTitleSheet');
    var google = document.getElementById('googleButton');
    title.textContent = 'Merge schedule';
    msg.textContent = 'You have a cloud backup (' + cloud.events.length +
      ' blocks' + (Array.isArray(cloud.todos) && cloud.todos.length ? ' + ' + cloud.todos.length + ' to-dos' : '') +
      ') and local data on this device. Which would you like to use?';
    google.hidden = false;
    google.textContent = 'Use cloud schedule';
    google.onclick = function () {
      var parsed = cloud.events.filter(app.validEvent);
      app.setEvents(parsed);
      if (Array.isArray(cloud.todos)) app.setTodos(cloud.todos.filter(app.validTodo));
      app.setSelectedDate(/^\d{4}-\d{2}-\d{2}$/.test(cloud.selectedDate || '')
        ? cloud.selectedDate : app.todayKey());
      if (cloud.settings && typeof cloud.settings === 'object') app.setSettings(cloud.settings);
      app.save(false);
      app.render();
      updateSyncUI();
      updateSettingsSync();
      app.close();
      google.onclick = null;
      if (onDone) onDone();
    };
    var keepBtn = document.getElementById('keepLocalButton');
    if (!keepBtn) {
      keepBtn = document.createElement('button');
      keepBtn.id = 'keepLocalButton';
      keepBtn.className = 'outline-button';
      keepBtn.style.marginTop = '11px';
      msg.parentNode.insertBefore(keepBtn, msg.nextSibling.nextSibling);
    }
    keepBtn.textContent = 'Keep local schedule';
    keepBtn.hidden = false;
    keepBtn.onclick = function () {
      saveToCloud();
      app.toast('Local schedule saved to cloud.');
      updateSyncUI();
      updateSettingsSync();
      app.close();
      keepBtn.onclick = null;
      if (onDone) onDone();
    };
    sheet.hidden = false;
    requestAnimationFrame(function () { sheet.classList.add('active'); });
  }

  function saveToCloud() {
    if (!ready() || !currentUser) return;
    var app = window.TempoApp;
    if (!app) return;
    var ref = db.collection('users').doc(currentUser.uid).collection('schedule').doc('main');
    ref.set({
      events: app.getState().events,
      todos: app.getState().todos || [],
      selectedDate: app.getState().selectedDate,
      settings: app.getState().settings,
      updatedAt: new Date().toISOString(),
      tzOffset: new Date().getTimezoneOffset()
    }).catch(function (e) {
      console.warn('Tempo: cloud save failed', e);
    });
  }

  function startListener() {
    if (!ready() || !currentUser) return;
    if (unsubscribe) unsubscribe();
    var ref = db.collection('users').doc(currentUser.uid).collection('schedule').doc('main');
    unsubscribe = ref.onSnapshot(function (snap) {
      if (!snap.exists) return;
      var data = snap.data();
      if (!Array.isArray(data.events)) return;
      var now = Date.now();
      if (window._tempoLastCloudSave && now - window._tempoLastCloudSave < 3000) return;
      var app = window.TempoApp;
      if (!app) return;
      app.setEvents(data.events.filter(app.validEvent));
      if (Array.isArray(data.todos)) app.setTodos(data.todos.filter(app.validTodo));
      if (/^\d{4}-\d{2}-\d{2}$/.test(data.selectedDate || '')) app.setSelectedDate(data.selectedDate);
      if (data.settings && typeof data.settings === 'object') app.setSettings(data.settings);
      app.render();
    }, function (e) {
      console.warn('Tempo: listener error', e);
    });
  }

  function stopListener() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  }

  function onAuthChanged(user) {
    currentUser = user;
    stopListener();
    if (window.TempoNotifications) window.TempoNotifications.onAuthChanged(user ? user.uid : null);
    if (user) {
      updateSyncUI();
      updateSettingsSync();
      loadScheduleFromCloud(function () { startListener(); });
    } else {
      updateSyncUI();
      updateSettingsSync();
    }
  }

  function updateSyncUI() {
    var dot = document.querySelector('.sync-dot');
    var title = document.getElementById('syncTitle');
    var text = document.getElementById('syncText');
    if (currentUser) {
      if (dot) dot.classList.add('cloud');
      if (title) title.textContent = 'Cloud sync';
      if (text) text.textContent = currentUser.email || 'Signed in';
    } else {
      if (dot) dot.classList.remove('cloud');
      if (title) title.textContent = 'Offline mode';
      if (text) text.textContent = 'Saved on this device';
    }
  }

  function updateSettingsSync() {
    var el = document.getElementById('settingsSync');
    var gbtn = document.getElementById('googleButton');
    if (currentUser) {
      if (el) el.textContent = 'Signed in as ' + (currentUser.email || 'Google user') + '. Schedule syncs automatically.';
      if (gbtn) { gbtn.hidden = true; gbtn.textContent = 'Continue with Google'; }
    } else {
      if (el) el.textContent = 'Offline mode — your schedule is saved only on this device.';
      if (gbtn) { gbtn.hidden = false; gbtn.textContent = 'Continue with Google'; }
    }
  }

  function signIn() {
    if (!ready()) {
      if (window.TempoApp) window.TempoApp.toast('Firebase is not configured. Add firebase-config.js to enable cloud sync.');
      return;
    }
    if (signingIn) return;
    signingIn = true;
    var provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).then(function (result) {
      console.log('Tempo: sign-in successful', result.user.email);
    }).catch(function (e) {
      console.error('Tempo: signInWithPopup error', e.code, e.message);
      var msg = signInError(e);
      if (msg && window.TempoApp) window.TempoApp.toast(msg);
    }).finally(function () { signingIn = false; });
  }

  function signOut() {
    if (!ready()) return;
    stopListener();
    auth.signOut().catch(function (e) {
      console.warn('Tempo: sign-out failed', e);
    });
  }

  function init() {
    if (typeof firebase === 'undefined' || !window.TEMPO_FIREBASE_CONFIG) return;
    if (app) return;
    try {
      app = firebase.initializeApp(window.TEMPO_FIREBASE_CONFIG);
      auth = firebase.auth();
      db = firebase.firestore();
      auth.onAuthStateChanged(onAuthChanged);
      updateSyncUI();
      updateSettingsSync();
    } catch (e) {
      console.warn('Tempo: Firebase init failed', e);
    }
  }

  return {
    ready: ready,
    init: init,
    signIn: signIn,
    signOut: signOut,
    saveToCloud: saveToCloud,
    loadScheduleFromCloud: loadScheduleFromCloud,
    updateSyncUI: updateSyncUI,
    updateSettingsSync: updateSettingsSync
  };
})();
