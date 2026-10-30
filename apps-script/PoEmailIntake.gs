/**
 * BunkerOps — PO email intake (Google Apps Script, runs in the mailbox account).
 *
 * Reads Daidan emails that contain "No PO" and sends each one to the BunkerOps
 * Cloud Function `ingestPOEmail`, which creates DRAFT sales orders (status
 * "Pending approval", no SO number). A supervisor approves them in BunkerOps.
 *
 * It runs only when asked:
 *   - manually: BunkerOps → Sales Requests → 📧 CHECK EMAIL
 *   - automatically every 10 minutes, if switched on in BunkerOps → Settings
 * BunkerOps reaches this script through its web-app URL (doPost below); every
 * call must carry the shared secret.
 *
 * Setup (once):
 *   1. script.google.com → New project → paste this file → save.
 *   2. Project Settings → Script properties → add
 *        INGEST_SECRET = <same value as `firebase functions:secrets:set EMAIL_INGEST_SECRET`>
 *   3. Select function `setup` → Run → allow access.
 *   4. Deploy → New deployment → type "Web app" → Execute as: Me,
 *      Who has access: Anyone → Deploy → copy the Web app URL
 *      → `firebase functions:secrets:set EMAIL_SCRIPT_URL` and paste it.
 *   After editing this file later: Deploy → Manage deployments → edit → Version: New version.
 */

const INGEST_URL = 'https://asia-southeast1-fuelops-pps.cloudfunctions.net/ingestPOEmail';
const SENDER_DOMAIN = 'daidan.co.id';
// Threads are searched even after labelling, because Daidan often adds new
// PO emails to the same thread; each message is sent only once (remembered below).
const QUERY = 'from:@' + SENDER_DOMAIN + ' "No PO" newer_than:14d';
const LABEL_DONE = 'bunkerops-done';
const LABEL_FAILED = 'bunkerops-failed';

function setup() {
  label_(LABEL_DONE); label_(LABEL_FAILED);
  if (!PropertiesService.getScriptProperties().getProperty('INGEST_SECRET')) {
    throw new Error('Add the script property INGEST_SECRET first (Project Settings → Script properties).');
  }
  console.log('Ready. Now deploy as a web app (see step 4 at the top).');
}

// ---- Called by BunkerOps -----------------------------------------------------
function doPost(e) {
  let req = {};
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ error: 'bad request' }); }
  const secret = PropertiesService.getScriptProperties().getProperty('INGEST_SECRET');
  if (!secret || req.secret !== secret) return json_({ error: 'not authorised' });

  if (req.action === 'check') {
    const summary = processInbox('manual: ' + (req.by || 'BunkerOps'));
    return json_(summary);
  }
  if (req.action === 'setAuto') {
    setAuto_(!!req.auto);
    PropertiesService.getScriptProperties().setProperty('AUTO_CHANGED',
      JSON.stringify({ by: req.by || '', at: new Date().toISOString(), auto: !!req.auto }));
    return json_(status_());
  }
  if (req.action === 'status') return json_(status_());
  return json_({ error: 'unknown action' });
}

// ---- The 10-minute trigger calls this with no argument ------------------------
function processInbox(how) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { busy: true, note: 'a check is already running — try again in a minute' };
  const summary = { emails: 0, created: 0, skipped: 0, rejected: 0, errors: 0, details: [] };
  try {
    const props = PropertiesService.getScriptProperties();
    const secret = props.getProperty('INGEST_SECRET');
    if (!secret) throw new Error('Script property INGEST_SECRET is missing.');
    const done = label_(LABEL_DONE), failed = label_(LABEL_FAILED);
    const seen = JSON.parse(props.getProperty('SEEN_IDS') || '[]');
    const seenSet = {}; seen.forEach(function (id) { seenSet[id] = true; });

    GmailApp.search(QUERY, 0, 30).forEach(function (thread) {
      let threadOk = true, threadFailed = false;
      thread.getMessages().forEach(function (msg) {
        if (seenSet[msg.getId()]) return;
        // Only messages actually sent by the client, not our own replies in the thread.
        const from = msg.getFrom();
        if (from.toLowerCase().indexOf('@' + SENDER_DOMAIN) === -1) return;
        if (msg.getPlainBody().indexOf('No PO') === -1 && msg.getBody().indexOf('No PO') === -1) return;

        summary.emails++;
        const resp = UrlFetchApp.fetch(INGEST_URL, {
          method: 'post',
          contentType: 'application/json',
          headers: { 'X-Ingest-Secret': secret },
          muteHttpExceptions: true,
          payload: JSON.stringify({
            messageId: msg.getId(),
            rfcMessageId: msg.getHeader('Message-ID'),
            from: from,
            subject: msg.getSubject(),
            date: msg.getDate().toISOString(),
            html: msg.getBody(),
            text: msg.getPlainBody(),
            auth: msg.getHeader('Authentication-Results'),
          }),
        });
        const code = resp.getResponseCode();
        let body = {};
        try { body = JSON.parse(resp.getContentText()); } catch (err) {}
        console.log(msg.getSubject() + ' → ' + code + ' ' + resp.getContentText().slice(0, 300));
        if (code >= 500) { threadOk = false; summary.errors++; return; }   // server trouble: try again next run
        if (code >= 400) { threadFailed = true; summary.rejected++; }      // rejected: don't keep retrying
        summary.created += (body.created || []).length;
        summary.skipped += (body.skipped || []).length;
        summary.details.push({ subject: msg.getSubject(), status: code,
          created: (body.created || []).map(function (c) { return c.po; }),
          skipped: body.skipped || [], error: body.error || '' });
        seenSet[msg.getId()] = true; seen.push(msg.getId());
      });
      if (threadFailed) thread.addLabel(failed);
      else if (threadOk) thread.addLabel(done);
    });
    props.setProperty('SEEN_IDS', JSON.stringify(seen.slice(-400)));
    props.setProperty('LAST_RUN', JSON.stringify({ at: new Date().toISOString(), how: typeof how === 'string' ? how : 'auto',
      emails: summary.emails, created: summary.created, skipped: summary.skipped }));
    return summary;
  } finally {
    lock.releaseLock();
  }
}

function setAuto_(on) {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'processInbox'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  if (on) ScriptApp.newTrigger('processInbox').timeBased().everyMinutes(10).create();
}

function status_() {
  const props = PropertiesService.getScriptProperties();
  const auto = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'processInbox'; });
  return {
    auto: auto,
    lastRun: JSON.parse(props.getProperty('LAST_RUN') || 'null'),
    autoChanged: JSON.parse(props.getProperty('AUTO_CHANGED') || 'null'),
    mailbox: Session.getEffectiveUser().getEmail(),
  };
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function label_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
