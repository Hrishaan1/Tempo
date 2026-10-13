/*  Small helpers for the Vercel serverless routes. */
'use strict';

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendText(res, status, body, extraHeaders) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  if (extraHeaders) Object.keys(extraHeaders).forEach((k) => res.setHeader(k, extraHeaders[k]));
  res.end(body);
}

module.exports = { sendJson, sendText };
