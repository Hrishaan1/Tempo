/*  Tempo → Apple Calendar feed.
 *
 *  Pure, dependency-light calendar logic shared by the HTTPS feed function and
 *  the unit tests. Nothing in here talks to Firestore or reads secrets, so it
 *  can be exercised without the Firebase Admin SDK.
 *
 *  Data model (see app.js / firebase.js):
 *    schedule doc = { events:[...], allDay:[...] }
 *    event  = { id, title, date:'YYYY-MM-DD', start, end (minutes from local midnight),
 *               color, repeat:'once'|'daily'|'weekdays'|'weekly',
 *               excludedDates:[dateKey], overrides:{ [dateKey]: {title,start,end,color} } }
 *    allDay = { id, title, date, repeat, excludedDates }
 *
 *  Times are stored as local wall-clock minutes with no IANA time zone, so the
 *  feed emits *floating* DATE-TIME values (RFC 5545 §3.3.5). That preserves the
 *  intended local time, is stable across daylight-saving transitions, and needs
 *  no VTIMEZONE block. All-day items use VALUE=DATE.
 */
'use strict';

const crypto = require('crypto');
const ical = require('ical-generator');

const icalFactory = typeof ical === 'function' ? ical : ical.default;

const DAY_MS = 86400000;
const CALENDAR_NAME = 'Tempo';
const PROD_ID = '//Tempo//Apple Calendar Feed//EN';
const FEED_TTL_SECONDS = 900; // hint to clients: re-check roughly every 15 minutes
const LOOKBACK_DAYS = 31; // keep a little history for recently finished blocks
const LOOKAHEAD_DAYS = 366; // recurring series are expanded one year ahead
const MAX_OCCURRENCES = 8000; // hard cap so one feed can never explode
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

const pad = (n) => String(n).padStart(2, '0');

function isDateKey(k) {
  return typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);
}

function dateKeyOf(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function keyToUtcMs(k) {
  const [y, m, d] = k.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function weekdayOfKey(k) {
  return new Date(keyToUtcMs(k)).getUTCDay(); // 0 = Sunday
}

function shiftKey(k, days) {
  return dateKeyOf(new Date(keyToUtcMs(k) + days * DAY_MS));
}

/* ---- token helpers ---- */

function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function looksLikeToken(token) {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

function shortIdHash(id) {
  return crypto.createHash('sha1').update(String(id), 'utf8').digest('hex').slice(0, 16);
}

/* ---- eligibility (lenient: malformed records are skipped, never fatal) ---- */

function isValidEvent(e) {
  if (!e || typeof e.id !== 'string' || !e.id) return false;
  if (typeof e.title !== 'string') return false;
  if (!isDateKey(e.date)) return false;
  if (!Number.isInteger(e.start) || !Number.isInteger(e.end)) return false;
  if (e.start < 0 || e.end > 1440 || e.end <= e.start) return false;
  return true;
}

function isValidAllDay(a) {
  return !!a && typeof a.id === 'string' && !!a.id && typeof a.title === 'string' && isDateKey(a.date);
}

/* ---- recurrence, mirroring app.js occurs() ---- */

function occursOn(item, k) {
  if (item.date === k) return true;
  const repeat = item.repeat || 'once';
  if (!isDateKey(item.date) || item.date > k || repeat === 'once') return false;
  if (Array.isArray(item.excludedDates) && item.excludedDates.indexOf(k) !== -1) return false;
  const dow = weekdayOfKey(k);
  return repeat === 'daily'
    || (repeat === 'weekdays' && dow > 0 && dow < 6)
    || (repeat === 'weekly' && weekdayOfKey(item.date) === dow);
}

function resolveOccurrence(event, k) {
  const o = event.overrides && event.overrides[k];
  const start = o && Number.isInteger(o.start) ? o.start : event.start;
  const end = o && Number.isInteger(o.end) ? o.end : event.end;
  const title = o && typeof o.title === 'string' ? o.title : event.title;
  return { start, end, title };
}

function validSpan(start, end) {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= 1440 && end > start;
}

/* ---- occurrence collection ---- */

function collectOccurrences(events, allDay, now) {
  const nowDate = now instanceof Date ? now : new Date();
  const windowStart = shiftKey(dateKeyOf(nowDate), -LOOKBACK_DAYS);
  const windowEnd = shiftKey(dateKeyOf(nowDate), LOOKAHEAD_DAYS);
  const timed = [];
  const whole = [];
  let truncated = false;

  const pushTimed = (event, k) => {
    const r = resolveOccurrence(event, k);
    if (!validSpan(r.start, r.end)) return;
    timed.push({ event, dateKey: k, start: r.start, end: r.end, title: r.title });
  };
  const pushWhole = (item, k) => whole.push({ item, dateKey: k });

  const count = () => timed.length + whole.length;
  const full = () => count() >= MAX_OCCURRENCES;

  if (Array.isArray(events)) {
    for (const event of events) {
      if (full()) { truncated = true; break; }
      if (!isValidEvent(event)) continue;
      if ((event.repeat || 'once') === 'once') {
        pushTimed(event, event.date);
        continue;
      }
      const start = event.date > windowStart ? event.date : windowStart;
      for (let k = start; k <= windowEnd; k = shiftKey(k, 1)) {
        if (occursOn(event, k)) {
          pushTimed(event, k);
          if (full()) { truncated = true; break; }
        }
      }
    }
  }

  if (Array.isArray(allDay)) {
    for (const item of allDay) {
      if (full()) { truncated = true; break; }
      if (!isValidAllDay(item)) continue;
      if ((item.repeat || 'once') === 'once') {
        pushWhole(item, item.date);
        continue;
      }
      const start = item.date > windowStart ? item.date : windowStart;
      for (let k = start; k <= windowEnd; k = shiftKey(k, 1)) {
        if (occursOn(item, k)) {
          pushWhole(item, k);
          if (full()) { truncated = true; break; }
        }
      }
    }
  }

  return { timed, whole, truncated };
}

/* ---- serialization ---- */

function utcDateFromMinutes(k, minutes) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60, 0, 0));
}

function buildCalendar(opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const stamp = opts.stamp instanceof Date && !isNaN(opts.stamp.getTime()) ? opts.stamp : now;
  const cal = icalFactory({
    name: opts.calendarName || CALENDAR_NAME,
    prodId: PROD_ID,
    method: 'PUBLISH',
    ttl: FEED_TTL_SECONDS,
  });

  const { timed, whole } = collectOccurrences(opts.events, opts.allDay, now);

  for (const occ of timed) {
    try {
      cal.createEvent({
        id: `tempo-${occ.dateKey}-${shortIdHash(occ.event.id)}@tempo.local`,
        start: utcDateFromMinutes(occ.dateKey, occ.start),
        end: utcDateFromMinutes(occ.dateKey, occ.end),
        floating: true,
        stamp,
        summary: occ.title || 'Time block',
      });
    } catch (err) {
      /* Skip a single malformed event rather than failing the whole feed. */
    }
  }

  for (const occ of whole) {
    try {
      const [y, m, d] = occ.dateKey.split('-').map(Number);
      cal.createEvent({
        id: `tempo-allday-${occ.dateKey}-${shortIdHash(occ.item.id)}@tempo.local`,
        start: new Date(Date.UTC(y, m - 1, d)),
        end: new Date(Date.UTC(y, m - 1, d + 1)),
        allDay: true,
        stamp,
        summary: occ.item.title || 'All-day note',
      });
    } catch (err) {
      /* Skip a single malformed all-day note rather than failing the feed. */
    }
  }

  return cal.toString();
}

/* ---- HTTP response shaping (pure, so it can be unit tested) ---- */

function feedHeaders(etag) {
  return {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Cache-Control': 'private, no-cache, must-revalidate',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  };
}

function notFoundResponse() {
  return {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    body: 'Not found',
  };
}

async function handleFeedRequest(opts = {}) {
  const { method, token, ifNoneMatch, lookupSubscription, getSchedule } = opts;

  if (method && method !== 'GET' && method !== 'HEAD') {
    return {
      status: 405,
      headers: { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      body: 'Method not allowed',
    };
  }

  if (!looksLikeToken(token)) return notFoundResponse();

  let subscription;
  try {
    subscription = await lookupSubscription(hashToken(token));
  } catch (err) {
    return { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: 'Unable to build calendar' };
  }
  if (!subscription || !subscription.uid) return notFoundResponse();

  let schedule = null;
  try {
    schedule = await getSchedule(subscription.uid);
  } catch (err) {
    return { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: 'Unable to build calendar' };
  }

  const ics = buildCalendar({
    events: schedule && schedule.events,
    allDay: schedule && schedule.allDay,
    now: opts.now || new Date(),
    stamp: schedule && schedule.updatedAt ? new Date(schedule.updatedAt) : opts.now || new Date(),
  });

  const etag = '"' + crypto.createHash('sha1').update(ics).digest('hex') + '"';
  const headers = feedHeaders(etag);

  if (ifNoneMatch && ifNoneMatch === etag) {
    return { status: 304, headers, body: '' };
  }
  return { status: 200, headers, body: ics };
}

module.exports = {
  DAY_MS,
  FEED_TTL_SECONDS,
  LOOKBACK_DAYS,
  LOOKAHEAD_DAYS,
  MAX_OCCURRENCES,
  buildCalendar,
  collectOccurrences,
  dateKeyOf,
  generateToken,
  handleFeedRequest,
  hashToken,
  isValidAllDay,
  isValidEvent,
  looksLikeToken,
  occursOn,
  resolveOccurrence,
  shiftKey,
};
