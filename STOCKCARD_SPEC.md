# bunkerops — Stock Card Module Spec

**For:** Claude Code (or any dev). Build the Stock Cards module in the existing `bunkerops` React + Firebase app per this spec. Do not invent the model — follow it exactly.

**Stack context (already in repo):** React 18 + Vite, Firebase Firestore. Collections prefixed `bunkerops_`. Shared helpers exist: `src/modules/useCollection.js` (live CRUD hook with `add/update/remove/setWithId`, strips `undefined`), `src/config.js` (COL map, NODES, BUCKETS, SCHEMES, TOLERANCE_PCT=0.3, ROMAN months, formatters), `src/tokens.js` (`T`, `s` styling), `src/roles.js` (`canAccess`, `canManage`). Modules receive a `role` prop. Add `stockCards` collection to `COL` in config if missing: `stockCards: PFX + 'stockCards'`.

---

## 1. Core concept

Physical fuel sits in **OB Galley floating storage**, split into **two ownership buckets — PPS and MBSS — that are NEVER commingled**. Each bucket is reconciled **monthly**. A stock card tracks, per bucket per calendar month, how much fuel came in, went out, and what's actually left versus what the books say.

**One stock card = one node + one bucket + one calendar month.**
Doc ID pattern: `{nodeId}_{bucket}_{YYYY-MM}` e.g. `ob_galley_MBSS_2026-07`.

---

## 2. The numbers (exact formulas — do not deviate)

Volume symbols:
- **C** = incoming cargo volume (into the bucket this month)
- **D** = dispatched volume (out of the bucket) — comes from Delivery Orders
- **openingROB** = last month's *measured* closing ROB for this same bucket (carried forward)
- **bookROB** = `openingROB + ΣC − ΣD`  (what records say should remain)
- **measuredROB** = month-end sounding (physically measured; manual entry)
- **storageLoss** = `bookROB − measuredROB`

**Tolerance & compensation:**
- `toleranceAllowance = 0.3% × ΣC`  (TOLERANCE_PCT = 0.3, i.e. 0.003 × ΣC)
- `excessLoss = max(0, storageLoss − toleranceAllowance)`
- Owner absorbs loss up to the allowance; USI PTS compensates only `excessLoss`.
- `compensationValue` = **manual input** (IDR), deferred pricing. Do NOT auto-calculate.

**CRITICAL RULES:**
- **Dispatched (D) debits the tank.** The bucket loses the full dispatched amount.
- **Transit loss (D − BAST standard-litres received) is NOT a stock-card figure.** It lives on the BAST. Do not compute or store it here. Do NOT sum transit loss with storage loss — they are different phenomena.
- **Received volume basis is Liter Standard (@15°C), never observed** — but note: received volume is a BAST concern, not a stock-card concern. Stock card only cares about D (dispatched out).
- Full precision through all intermediate steps. Round only at display (Indonesian `toLocaleString('id-ID')`).

---

## 3. Data model — `bunkerops_stockCards/{id}`

```
{
  id,                    // 'ob_galley_MBSS_2026-07'
  nodeId,                // 'ob_galley'
  nodeName,              // 'OB Galley'
  bucket,                // 'PPS' | 'MBSS'
  periodYear,            // 2026
  periodMonth,           // 7 (1-12)
  periodLabel,           // 'Juli 2026'
  openingROB,            // number (L) — carried from prior month measured ROB; editable for first card
  incoming: [            // cargo receipts INTO this bucket this month
    { id, date, cargoRef, volumeL, vhsRatePerL, notes }
    // vhsFee = volumeL * vhsRatePerL (compute on display, don't store)
  ],
  dispatched: [          // OUT this month — sourced from DOs matching node+bucket+month
    { id, date, deliveryOrderId, doNumber, dispatchedL, notes }
  ],
  measuredROB,           // number|null — month-end sounding, manual, null until close
  compensationValue,     // number|null — manual IDR, deferred
  compensationNote,
  status,                // 'open' | 'closed' | 'locked'
  closedBy, closedAt,
  createdAt, createdBy
}
```

Computed on read (NOT stored as source of truth):
- `totalC = Σ incoming.volumeL`
- `totalD = Σ dispatched.dispatchedL`
- `bookROB = openingROB + totalC − totalD`
- `storageLoss = (measuredROB == null) ? null : bookROB − measuredROB`
- `toleranceAllowance = 0.003 * totalC`
- `excessLoss = (storageLoss == null) ? null : Math.max(0, storageLoss − toleranceAllowance)`
- `totalVhsFee = Σ (incoming.volumeL * incoming.vhsRatePerL)`

---

## 4. Dispatched auto-population (from DOs)

Dispatched entries should be pulled from existing Delivery Orders, not typed manually.
- A DO has: `nodeId`, `bucket`, `brDate`, `brNo`, `dispatchedVolumeL`, `status`.
- Match DOs where `nodeId === card.nodeId`, `bucket === card.bucket`, and `brDate` falls in the card's month/year.
- Provide a **"Sync dispatched from DOs"** button that populates/refreshes the `dispatched[]` array from matching DOs. (Read-only pull; user clicks to sync. Don't silently overwrite manual notes — match by `deliveryOrderId`.)
- Show each dispatched row: date, DO number, dispatchedL.

Incoming cargo is **manual** for now (add/edit/delete rows in an incoming section): date, cargoRef, volumeL, vhsRatePerL, notes. (Later this links to a FuelOps incoming-cargo feed — leave a comment noting this.)

---

## 5. UI / behaviour

**Module: `src/modules/StockCards.jsx`**, wired into `App.jsx` menu (cap `stockCards`) and routed. Roles: view for supervisor/operator; edit/close for superadmin/director (`canManage(role,'stockCards')`).

Layout:
1. **Selector row:** Node (from `bunkerops_nodes`), Bucket (PPS/MBSS), Month (year + month picker). These three identify/create the card (`{nodeId}_{bucket}_{YYYY-MM}`).
2. **Load or create** that card. First-ever card for a bucket: `openingROB` editable. Subsequent: auto-fill `openingROB` from prior month's `measuredROB` (look up `{nodeId}_{bucket}_{prevYYYY-MM}`), still editable.
3. **Summary panel** (computed, live): openingROB, ΣC, ΣD, bookROB, measuredROB input, storageLoss, toleranceAllowance (0.3%×C), excessLoss, totalVhsFee, compensationValue input + note.
4. **Incoming section:** editable table (add/edit/del rows). Thousand separators on volumes (reuse `VolumeInput` component from `src/modules/VolumeInput.jsx`).
5. **Dispatched section:** table + "Sync from DOs" button. Read-only volumes.
6. **Close/lock:** superadmin/director can set `measuredROB`, then **Close** (status→closed, records closedBy/closedAt) and **Lock** (status→locked, immutable — block all edits when locked). Locked card: everything read-only.

All volumes display with `id-ID` thousand separators. Use `T`/`s` tokens for styling to match existing modules. Money (`compensationValue`, VHS fee) display as `Rp {toLocaleString('id-ID')}`.

---

## 6. Guardrails

- Never commingle buckets — every query/compute is per-bucket.
- Never sum storage loss and transit loss.
- Don't compute transit loss here at all.
- Round only at display.
- Strip `undefined` before Firestore writes (the `useCollection` hook already does this — use it).
- A locked card rejects writes in the UI.
- Use `setWithId(cardId, data)` to create cards at the deterministic ID, not `add()`.

---

## 7. Out of scope (do NOT build now)

- Auto-pricing of compensation (manual only).
- Linking incoming cargo to FuelOps (manual entry for now; leave a TODO comment).
- Invoicing.
- Multi-node aggregation views (one card at a time is fine).
