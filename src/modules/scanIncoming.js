// scanIncoming.js — read a scanned incoming-cargo / surveyor report (jpg, png,
// or pdf) with Gemini (via Firebase AI Logic) and extract the 4 loading points.
//
// Returns the figures ONLY — the caller fills a new incoming-cargo row as an
// editable draft. The scan is sent to Gemini and discarded; it is never stored
// in Firestore or anywhere else.
//
// Billing/keys are handled by Firebase AI Logic on the fuelops-pps project
// (no API key in the browser). The Vertex AI / Firebase AI Logic API must be
// enabled once for the project in the Firebase console.

import { getAI, getGenerativeModel, GoogleAIBackend, Schema } from 'firebase/ai';
import { app } from '../firebase';

const ACCEPT = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
export const SCAN_ACCEPT = 'image/png,image/jpeg,application/pdf';

// One loading point: observed (required on the sheet), liter@15°C, density, temp.
const pointSchema = () => Schema.object({
  properties: {
    obs:     Schema.number({ description: 'Observed liters (Qty liters OBS). Number only, no thousands separators.' }),
    l15:     Schema.number({ description: 'Liters corrected to 15°C (Qty Liter 15°C). Number only.' }),
    density: Schema.number({ description: 'Density OBS (e.g. 0.8540). Number only.' }),
    temp:    Schema.number({ description: 'Temperature in °C (Temperatur). Number only.' }),
  },
  optionalProperties: ['obs', 'l15', 'density', 'temp'],
});

const responseSchema = Schema.object({
  properties: {
    bl:     pointSchema(),   // B/L — the shore / before-loading figure
    sfal:   pointSchema(),   // SFAL — After Loading (R1)
    sfbd:   pointSchema(),   // SFBD — Before Discharging (R2)
    actual: pointSchema(),   // Actual Received (AKTUAL PENERIMAAN) — final figure
  },
  optionalProperties: ['bl', 'sfal', 'sfbd', 'actual'],
});

const PROMPT = `You are reading a marine fuel cargo surveyor report (Indonesian).
Extract the quantity figures for these FOUR measurement points and return them
in the given JSON schema. Map the document's sections as follows:

- "bl"     = the Bill of Lading / loading figure. On the sheet this is the TOP
             block (before "AFTER LOADING"), labelled with "Qty liters OBS" and
             "Qty Liter 15 °C" at the loading port.
- "sfal"   = "AFTER LOADING ( R1 )" block (Ship Figure After Loading).
- "sfbd"   = "BEFORE DISCHARGING ( R2 )" block (Ship Figure Before Discharging).
- "actual" = "AKTUAL PENERIMAAN" / "ACTUAL PENERIMAAN" block (Actual Received),
             the real quantity received at destination.

For each point capture, when present:
- obs     = "Qty liters OBS" (observed liters)
- l15     = "Qty Liter 15 °C" (corrected to 15°C)
- density = "Density OBS"
- temp    = "Temperatur" (°C)

Rules:
- Numbers only. Strip thousands separators ("200.000" -> 200000, "197.970" -> 197970).
  Indonesian sheets use "." as the thousands separator and "," as decimal, so
  density "0,8540" -> 0.854 and "0.8540" -> 0.854.
- Ignore "SELISIH" (difference) rows, barrels, long tons, metric tons.
- If a value is not legible or not present, leave that property out (null).
- Do NOT guess or compute R4 — only report the four measured points above.`;

// Read a File as a base64 string (no data: prefix).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
}

// Normalize one extracted point: coerce to numbers, drop empties.
function cleanPoint(p) {
  if (!p || typeof p !== 'object') return { obs: '', l15: '', density: '', temp: '' };
  const num = (x) => (x == null || x === '' || Number.isNaN(Number(x))) ? '' : Number(x);
  return { obs: num(p.obs), l15: num(p.l15), density: num(p.density), temp: num(p.temp) };
}

/**
 * Scan a report file and return { bl, sfal, sfbd, actual }, each
 * { obs, l15, density, temp } with numbers (or '' when not found).
 * Throws with a readable message on failure.
 */
export async function scanIncomingReport(file) {
  if (!file) throw new Error('No file selected.');
  const type = (file.type || '').toLowerCase();
  if (!ACCEPT.includes(type)) {
    throw new Error('Unsupported file type. Use JPG, PNG, or PDF.');
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('File is too large (max 20 MB).');
  }

  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const model = getGenerativeModel(ai, {
    model: 'gemini-2.0-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
      temperature: 0,
    },
  });

  const base64 = await fileToBase64(file);
  const mimeType = type === 'image/jpg' ? 'image/jpeg' : type;

  let text;
  try {
    const result = await model.generateContent([
      { inlineData: { mimeType, data: base64 } },
      { text: PROMPT },
    ]);
    text = result.response.text();
  } catch (e) {
    // Surface the most common setup error clearly.
    const msg = e?.message || String(e);
    if (/API|permission|enable|not.*found|403|404/i.test(msg)) {
      throw new Error('Scan service not reachable. Make sure the Firebase AI Logic (Vertex AI) API is enabled for this project. (' + msg + ')');
    }
    throw new Error('Could not read the report: ' + msg);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The report was read but the result could not be parsed. Try a clearer scan.');
  }

  return {
    bl:     cleanPoint(parsed.bl),
    sfal:   cleanPoint(parsed.sfal),
    sfbd:   cleanPoint(parsed.sfbd),
    actual: cleanPoint(parsed.actual),
  };
}
