import { useState, useMemo } from 'react';
import { T, s } from '../tokens';
import { COL, SCHEMES, ISSUERS, formatSoNumber } from '../config';
import { useCollection } from './useCollection';
import { allocateNumber } from './counters';
import VolumeInput from './VolumeInput';
import { useFuelOpsMaster } from './useFuelOpsMaster';
import { usePagination, PaginationBar, useIsNarrow, diffSOtoDO, useSort, SortHeader, StatusPill, MobileSortBar,
  ReasonDialog, useRefFilters, RefFilterInputs, DocLink, FocusBanner, cancelInfoLine } from './listUtils';
import { auth } from '../firebase';

const todayISO = () => new Date().toISOString().slice(0, 10);

const BLANK = {
  galleyPoRef: '', clientId: '', entityId: '', vesselName: '',
  scheme: 'PPS_SALE', nodeId: '', fuelTypeId: '',
  requestedVolumeL: '', deliveryLocation: '', requestedDate: todayISO(),
  status: 'requested',
};

const STATUS_COLORS = {
  pending_approval: '#f59e0b', requested: T.blue, do_issued: T.amber,
  bast_done: '#a855f7', reconciled: T.green, cancelled: T.red,
};
const statusColor = st => STATUS_COLORS[st] || T.textDim;
// Who may cancel a sales order (client cancelled the PO).
const CANCEL_ROLES = ['superadmin', 'director', 'supervisor'];
// Active statuses sort/show before terminal ones; cancelled sinks to the bottom.
const STATUS_RANK = { pending_approval: 0, requested: 1, do_issued: 2, bast_done: 3, reconciled: 4, cancelled: 9 };

export default function SalesRequests({ role, focus, onNavigate, canOpen = () => true, onClearFocus }) {
  const sr       = useCollection(COL.salesRequests);
  const doC      = useCollection(COL.deliveryOrders);
  const bastC    = useCollection(COL.bast);
  const clientsC = useCollection(COL.clients);
  const nodesC   = useCollection(COL.nodes);
  const { fuelTypes, error: ftError } = useFuelOpsMaster();

  const [form, setForm]     = useState(null);
  const [editId, setEditId] = useState(null);

  // Filters: requested-date range, client/entity, scheme.
  const [fFrom, setFFrom]     = useState('');
  const [fTo, setFTo]         = useState('');
  const [fClient, setFClient] = useState('');
  const [fScheme, setFScheme] = useState('');

  const narrow = useIsNarrow();

  const clients = clientsC.data;
  const nodes   = nodesC.data;

  // cascading option sources
  const selClient = useMemo(() => clients.find(c => c.id === form?.clientId), [clients, form?.clientId]);
  const entities  = selClient?.entities || [];
  const selEntity = useMemo(() => entities.find(e => e.id === form?.entityId), [entities, form?.entityId]);
  const vessels   = selEntity?.vessels || [];

  const scheme = form ? SCHEMES[form.scheme] : null;
  const derivedBucket = scheme?.bucket;
  const derivedIssuer = scheme ? ISSUERS[scheme.issuer]?.name : '';

  // Sortable columns — each maps a header key to a comparable value.
  const sortCols = useMemo(() => ({
    soNumber: r => r.soNumber || '',
    poRef:    r => r.galleyPoRef || '',
    date:     r => r.requestedDate || '',
    client:   r => `${r.clientName || ''} ${r.entityName || ''}`,
    vessel:   r => r.vesselName || '',
    scheme:   r => r.scheme || '',
    fuel:     r => r.fuelTypeShort || r.fuelTypeName || '',
    volume:   r => Number(r.requestedVolumeL) || 0,
    status:   r => STATUS_RANK[r.status] ?? 5,
  }), []);

  // Client-group dropdown options (entity has its own filter below).
  const clientOpts = useMemo(
    () => [...new Set(sr.data.map(r => r.clientName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [sr.data]);

  // Apply filters (requested-date range + client/entity + scheme) before sort.
  const filteredRows = useMemo(() => {
    return sr.data.filter(r => {
      if (fFrom && (!r.requestedDate || r.requestedDate < fFrom)) return false;
      if (fTo   && (!r.requestedDate || r.requestedDate > fTo))   return false;
      if (fClient && r.clientName !== fClient) return false;
      if (fScheme && (r.scheme || 'PPS_SALE') !== fScheme) return false;
      return true;
    });
  }, [sr.data, fFrom, fTo, fClient, fScheme]);

  // Client PO ref / entity / vessel filters (shared with DO and BAST pages).
  const refF = useRefFilters(filteredRows, {
    po: r => r.galleyPoRef, entity: r => r.entityName, vessel: r => r.vesselName });
  const filtersActive = fFrom || fTo || fClient || fScheme || refF.active;
  const clearFilters = () => { setFFrom(''); setFTo(''); setFClient(''); setFScheme(''); refF.clear(); };

  // Arrived via a link → show only that sales order.
  const listRows = focus ? sr.data.filter(r => r.id === focus.id) : refF.filtered;

  // Each SO's delivery order (for the SO → DO link).
  const doBySO = useMemo(() => {
    const m = {};
    for (const d of doC.data) if (d.salesRequestId) m[d.salesRequestId] = d;
    return m;
  }, [doC.data]);
  const bastByDO = useMemo(() => {
    const m = {};
    for (const b of bastC.data) if (b.deliveryOrderId) m[b.deliveryOrderId] = b;
    return m;
  }, [bastC.data]);

  // Default view: newest first. Cancelled rows always sink below active ones,
  // regardless of the chosen sort, so they read as "done/closed".
  const baseRows = useMemo(() => {
    return [...listRows].sort((a, b) => {
      const d = String(b.requestedDate || '').localeCompare(String(a.requestedDate || ''));
      if (d !== 0) return d;
      return String(b.soNumber || '').localeCompare(String(a.soNumber || ''));
    });
  }, [listRows]);

  const { sorted: userSorted, sortKey, sortDir, toggle, setSort } = useSort(baseRows, sortCols);
  // Keep cancelled at the bottom on top of whatever sort is active.
  const sortedRows = useMemo(() => {
    return [...userSorted].sort((a, b) => {
      const ac = a.status === 'cancelled' ? 1 : 0;
      const bc = b.status === 'cancelled' ? 1 : 0;
      return ac - bc;
    });
  }, [userSorted]);

  // Map SO id -> stale DO discrepancy count (item 1: flag SOs whose DO is out of sync).
  const staleBySO = useMemo(() => {
    const m = {};
    for (const d of doC.data) {
      if (!d.salesRequestId) continue;
      const so = sr.data.find(r => r.id === d.salesRequestId);
      if (!so) continue;
      const diffs = diffSOtoDO(so, d);
      if (diffs.length) m[so.id] = (m[so.id] || 0) + diffs.length;
    }
    return m;
  }, [doC.data, sr.data]);

  const pg = usePagination(sortedRows, 20);

  const startNew  = () => { setForm({ ...BLANK }); setEditId(null); };
  const startEdit = (r) => { setForm({ ...BLANK, ...r }); setEditId(r.id); };
  const cancel    = () => { setForm(null); setEditId(null); };

  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const onNode = (nodeId) => {
    const node = nodes.find(n => n.id === nodeId);
    setForm(f => ({ ...f, nodeId,
      deliveryLocation: f.deliveryLocation || (node?.location || '') }));
  };

  const save = async () => {
    if (!form.clientId || !form.entityId) { alert('Client and Entity are required.'); return; }
    if (!form.scheme || !form.nodeId)     { alert('Scheme and Node are required.'); return; }
    if (!form.requestedVolumeL)           { alert('Requested volume is required.'); return; }
    const ft = fuelTypes.find(f => f.id === form.fuelTypeId);
    const node = nodes.find(n => n.id === form.nodeId);
    let soNumber = form.soNumber;
    if (!editId) {
      const d = new Date(form.requestedDate);
      const seq = await allocateNumber('so', d.getFullYear());
      const issuerCode = ISSUERS[SCHEMES[form.scheme].issuer]?.code || 'PPS';
      soNumber = formatSoNumber({ seq, issuerCode, nodeCode: node?.code || '', monthIndex: d.getMonth(), year: d.getFullYear() });
    }
    const payload = {
      soNumber,
      galleyPoRef: form.galleyPoRef.trim(),
      clientId: form.clientId,
      clientName: selClient?.groupName || '',
      entityId: form.entityId,
      entityName: selEntity?.name || '',
      vesselName: form.vesselName,
      scheme: form.scheme,
      bucket: SCHEMES[form.scheme].bucket,
      issuerKey: SCHEMES[form.scheme].issuer,
      nodeId: form.nodeId,
      nodeName: node?.name || '',
      nodeCode: node?.code || '',
      fuelTypeId: form.fuelTypeId,
      fuelTypeName: ft?.name || form.fuelTypeName || '',
      fuelTypeShort: ft?.shortName || '',
      requestedVolumeL: Number(form.requestedVolumeL) || 0,
      deliveryLocation: form.deliveryLocation.trim(),
      requestedDate: form.requestedDate,
      status: form.status || 'requested',
    };
    if (editId) await sr.update(editId, payload);
    else        await sr.add(payload);
    cancel();
  };

  // Cancel an SO (client cancelled the PO). Nothing is ever deleted: the SO, its
  // DO and its BAST keep their numbers and are marked 'cancelled' with the reason,
  // who and when — so the team can follow up. Supervisor and above only.
  // If the BAST is already filled (delivery recorded), it must be RESET on the
  // BAST page first — cancelling a recorded delivery is never silent.
  const [cancelTarget, setCancelTarget] = useState(null);   // { r, theDO, theBAST }
  const canCancel = CANCEL_ROLES.includes(role);

  const cancelSO = (r) => {
    if (r.status === 'cancelled' || !canCancel) return;
    const theDO = doBySO[r.id] || null;
    const theBAST = theDO ? bastByDO[theDO.id] || null : null;
    if (theBAST && theBAST.status !== 'blank' && theBAST.status !== 'cancelled') {
      alert(`Cannot cancel ${r.soNumber}: BAST ${theBAST.nomorBast} is filled (delivery recorded).\n\n` +
        `Reset the BAST on the BAST page first, then cancel this sales order.`);
      return;
    }
    setCancelTarget({ r, theDO, theBAST });
  };

  const doCancel = async (reason) => {
    const { r, theDO, theBAST } = cancelTarget;
    const stamp = {
      status: 'cancelled', cancelReason: reason,
      cancelledBy: auth.currentUser?.email || '', cancelledAt: new Date().toISOString(),
    };
    try {
      // Children first: a part-way failure never leaves a live BAST under a cancelled SO.
      if (theBAST && theBAST.status !== 'cancelled') await bastC.update(theBAST.id, stamp);
      if (theDO && theDO.status !== 'cancelled') await doC.update(theDO.id, stamp);
      await sr.update(r.id, stamp);
      setCancelTarget(null);
    } catch (e) {
      alert('Error cancelling: ' + e.message);
    }
  };

  const fmtL = n => (Number(n) || 0).toLocaleString('id-ID');

  const schemeLabel = r => `${r.scheme === 'PPS_SALE' ? 'PPS Sale' : 'Non-PPS'} · ${r.bucket}`;
  const schemeColor = r => (r.scheme === 'PPS_SALE' ? T.green : T.blue);

  return (
    <div style={{ padding: narrow ? 16 : 40, maxWidth: 1000 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1.5 }}>SALES ORDERS</div>
          <div style={{ fontSize: 12, color: T.textDim, marginTop: 4 }}>
            The trigger document. Scheme choice drives bucket, DO issuer, and revenue treatment.
          </div>
        </div>
        {!form && <button onClick={startNew} style={s.btn('primary')}>+ NEW SALES ORDER</button>}
      </div>

      {/* Arrived via a link: one record only */}
      {focus && <FocusBanner label={focus.label} onClear={onClearFocus} />}

      {/* Filter bar: date, client group, scheme, client PO ref, entity, vessel */}
      {!form && !focus && (
        <div style={{ ...s.card, marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.5, marginBottom: 10 }}>
            FILTERS {listRows.length !== sr.data.length && (
              <span style={{ color: T.amber }}>· {listRows.length} of {sr.data.length} shown</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={s.label}>Date — From</label>
              <input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)}
                style={{ ...s.input, width: 150, fontSize: 11 }} />
            </div>
            <div>
              <label style={s.label}>To</label>
              <input type="date" value={fTo} onChange={e => setFTo(e.target.value)}
                style={{ ...s.input, width: 150, fontSize: 11 }} />
            </div>
            <div>
              <label style={s.label}>Client Group</label>
              <select value={fClient} onChange={e => setFClient(e.target.value)}
                style={{ ...s.input, width: 180, fontSize: 11 }}>
                <option value="">— all —</option>
                {clientOpts.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={s.label}>Scheme</label>
              <select value={fScheme} onChange={e => setFScheme(e.target.value)}
                style={{ ...s.input, width: 220, fontSize: 11 }}>
                <option value="">— all —</option>
                {Object.values(SCHEMES).map(sc => <option key={sc.key} value={sc.key}>{sc.label}</option>)}
              </select>
            </div>
            <RefFilterInputs f={refF} />
            {filtersActive && (
              <button onClick={clearFilters} style={{ ...s.btn('ghost'), fontSize: 11 }}>CLEAR FILTERS</button>
            )}
          </div>
        </div>
      )}

      {form && (
        <div style={{ ...s.card, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1, marginBottom: 14 }}>
            {editId ? `EDIT ${form.soNumber || 'SALES ORDER'}` : 'NEW SALES ORDER'}
          </div>

          {editId && staleBySO[editId] > 0 && (
            <div style={{
              border: `1px solid ${T.amber}`, borderRadius: 4, padding: '10px 12px', marginBottom: 14,
              fontSize: 11, color: T.text, background: T.amberGlow,
            }}>
              Saving this SO will not update its already-issued DO. After saving, open{' '}
              <b>Delivery Orders</b> — the linked DO will show an "out of sync" banner where you can apply the changes.
            </div>
          )}

          {/* Client cascade */}
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={s.label}>Client Group</label>
              <select style={s.input} value={form.clientId}
                onChange={e => setForm(f => ({ ...f, clientId: e.target.value, entityId: '', vesselName: '' }))}>
                <option value="">— select —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.groupName}</option>)}
              </select>
            </div>
            <div>
              <label style={s.label}>Entity</label>
              <select style={s.input} value={form.entityId} disabled={!selClient}
                onChange={e => setForm(f => ({ ...f, entityId: e.target.value, vesselName: '' }))}>
                <option value="">— select —</option>
                {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label style={s.label}>Vessel</label>
              <select style={s.input} value={form.vesselName} disabled={!selEntity}
                onChange={e => sf('vesselName', e.target.value)}>
                <option value="">— select —</option>
                {vessels.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
              </select>
            </div>
          </div>

          {/* Scheme + derived */}
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={s.label}>Scheme</label>
              <select style={s.input} value={form.scheme} onChange={e => sf('scheme', e.target.value)}>
                {Object.values(SCHEMES).map(sc => <option key={sc.key} value={sc.key}>{sc.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 6, gap: 16 }}>
              <div style={{ fontSize: 11 }}>
                <span style={{ color: T.textDim }}>Bucket: </span>
                <span style={{ color: T.amber, fontWeight: 700 }}>{derivedBucket}</span>
              </div>
              <div style={{ fontSize: 11 }}>
                <span style={{ color: T.textDim }}>DO Issuer: </span>
                <span style={{ color: T.amber, fontWeight: 700 }}>{derivedIssuer}</span>
              </div>
            </div>
          </div>

          {/* Node + fuel + volume */}
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={s.label}>Source Node</label>
              <select style={s.input} value={form.nodeId} onChange={e => onNode(e.target.value)}>
                <option value="">— select —</option>
                {nodes.map(n => <option key={n.id} value={n.id}>{n.name} ({n.code})</option>)}
              </select>
            </div>
            <div>
              <label style={s.label}>Fuel Type</label>
              {ftError ? (
                <input style={s.input} placeholder="type fuel (FuelOps list unavailable)"
                  value={form.fuelTypeName || ''} onChange={e => sf('fuelTypeName', e.target.value)} />
              ) : (
                <select style={s.input} value={form.fuelTypeId} onChange={e => sf('fuelTypeId', e.target.value)}>
                  <option value="">— select —</option>
                  {fuelTypes.map(ft => <option key={ft.id} value={ft.id}>{ft.name}</option>)}
                </select>
              )}
            </div>
            <div>
              <label style={s.label}>Requested Volume (L)</label>
              <VolumeInput value={form.requestedVolumeL}
                onChange={v => sf('requestedVolumeL', v)} placeholder="21.000" />
            </div>
          </div>

          {/* Location + PO + date */}
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={s.label}>Delivery Location</label>
              <input style={s.input} value={form.deliveryLocation}
                onChange={e => sf('deliveryLocation', e.target.value)} placeholder="IWIP" />
            </div>
            <div>
              <label style={s.label}>Galley PO Ref</label>
              <input style={s.input} value={form.galleyPoRef}
                onChange={e => sf('galleyPoRef', e.target.value)} placeholder="PO number" />
            </div>
            <div>
              <label style={s.label}>Requested Date</label>
              <input style={s.input} type="date" value={form.requestedDate}
                onChange={e => sf('requestedDate', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} style={s.btn('primary')}>{editId ? 'SAVE' : 'CREATE'}</button>
            <button onClick={cancel} style={s.btn('ghost')}>CANCEL</button>
          </div>
        </div>
      )}

      {/* List */}
      {sr.loading ? (
        <div style={{ color: T.textDim, fontSize: 12 }}>Loading…</div>
      ) : sr.data.length === 0 ? (
        <div style={{ color: T.textFaint, fontSize: 12, padding: 20 }}>No sales orders yet.</div>
      ) : listRows.length === 0 ? (
        <div style={{ color: T.textFaint, fontSize: 12, padding: 20 }}>
          No sales orders match the current filters.{' '}
          <span onClick={clearFilters} style={{ color: T.amber, cursor: 'pointer', textDecoration: 'underline' }}>Clear filters</span>
        </div>
      ) : narrow ? (
        // -------- Mobile: stacked cards --------
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <MobileSortBar sortKey={sortKey} sortDir={sortDir} setSort={setSort}
            options={[{ key: 'soNumber', label: 'SO number' }, { key: 'poRef', label: 'PO ref' }, { key: 'date', label: 'Date' }, { key: 'client', label: 'Client / entity' }, { key: 'vessel', label: 'Vessel' }, { key: 'scheme', label: 'Scheme' }, { key: 'fuel', label: 'Fuel' }, { key: 'volume', label: 'Volume' }, { key: 'status', label: 'Status' }]} />
          {pg.pageRows.map(r => (
            <div key={r.id} style={{ ...s.card, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontFamily: T.font, color: T.amber, fontSize: 11 }}>{r.soNumber || '—'}</span>
                <StatusPill status={r.status} color={statusColor(r.status)} />
              </div>
              <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 4 }}>PO {r.galleyPoRef || '—'}</div>
              {doBySO[r.id] && canOpen('do') && (
                <div style={{ marginBottom: 4 }}>
                  <DocLink label={`→ ${doBySO[r.id].brNo}`} title="Open this delivery order"
                    onClick={() => onNavigate?.('do', doBySO[r.id].id, doBySO[r.id].brNo)} />
                </div>
              )}
              <div style={{ fontSize: 13, color: T.text }}>{r.clientName}</div>
              <div style={{ fontSize: 11, color: T.textDim, marginBottom: 6 }}>{r.entityName}</div>
              <div style={{ fontSize: 11, color: T.textDim, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <span>{r.requestedDate}</span>
                <span>· {r.vesselName || '—'}</span>
                <span>· {r.fuelTypeShort || r.fuelTypeName || '—'}</span>
                <span style={{ fontFamily: T.font }}>· {fmtL(r.requestedVolumeL)} L</span>
              </div>
              <div style={{ fontSize: 10, color: schemeColor(r), marginTop: 4 }}>{schemeLabel(r)}</div>
              {r.status === 'cancelled' && cancelInfoLine(r) && (
                <div style={{ fontSize: 10, color: T.red, marginTop: 4 }}>{cancelInfoLine(r)}</div>
              )}
              {staleBySO[r.id] > 0 && (
                <div style={{ fontSize: 10, color: T.amber, marginTop: 6 }}>
                  ⚠ Linked DO out of sync ({staleBySO[r.id]} field{staleBySO[r.id] > 1 ? 's' : ''})
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {r.status !== 'cancelled' && (
                  <button onClick={() => startEdit(r)} style={{ ...s.btn('ghost'), padding: '5px 12px', fontSize: 10 }}>EDIT</button>
                )}
                {r.status !== 'cancelled' && canCancel && (
                  <button onClick={() => cancelSO(r)} style={{ ...s.btn('ghost'), padding: '5px 12px', fontSize: 10, color: T.red, borderColor: T.red }}>CANCEL</button>
                )}
              </div>
            </div>
          ))}
          <PaginationBar {...pg} />
        </div>
      ) : (
        // -------- Desktop: table --------
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <SortHeader label="SO NUMBER" colKey="soNumber" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <SortHeader label="PO REF" colKey="poRef" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <SortHeader label="DATE" colKey="date" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <SortHeader label="CLIENT / ENTITY" colKey="client" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <SortHeader label="VESSEL" colKey="vessel" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <SortHeader label="SCHEME" colKey="scheme" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <SortHeader label="FUEL" colKey="fuel" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <SortHeader label="VOLUME (L)" colKey="volume" sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right" />
                <SortHeader label="STATUS" colKey="status" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {pg.pageRows.map(r => (
                <tr key={r.id}>
                  <td style={{ ...s.td, fontFamily: T.font, color: T.amber, fontSize: 10 }}>
                    {r.soNumber || '—'}
                    {staleBySO[r.id] > 0 && (
                      <span title={`Linked DO out of sync (${staleBySO[r.id]} field(s))`}
                        style={{ color: T.amber, marginLeft: 6 }}>⚠</span>
                    )}
                    {doBySO[r.id] && canOpen('do') && (
                      <div style={{ marginTop: 2 }}>
                        <DocLink label={`→ ${doBySO[r.id].brNo}`} title="Open this delivery order"
                          onClick={() => onNavigate?.('do', doBySO[r.id].id, doBySO[r.id].brNo)} />
                      </div>
                    )}
                  </td>
                  <td style={{ ...s.td, fontSize: 10 }}>{r.galleyPoRef || '—'}</td>
                  <td style={s.td}>{r.requestedDate}</td>
                  <td style={s.td}>
                    <div>{r.clientName}</div>
                    <div style={{ fontSize: 10, color: T.textDim }}>{r.entityName}</div>
                  </td>
                  <td style={s.td}>{r.vesselName || '—'}</td>
                  <td style={s.td}>
                    <span style={{ fontSize: 10, color: schemeColor(r) }}>{schemeLabel(r)}</span>
                  </td>
                  <td style={s.td}>{r.fuelTypeShort || r.fuelTypeName || '—'}</td>
                  <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font }}>{fmtL(r.requestedVolumeL)}</td>
                  <td style={s.td}>
                    <StatusPill status={r.status} color={statusColor(r.status)} />
                    {r.status === 'cancelled' && r.cancelReason && (
                      <div title={cancelInfoLine(r)} style={{ fontSize: 9, color: T.red, marginTop: 3, maxWidth: 160 }}>{r.cancelReason}</div>
                    )}
                  </td>
                  <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {r.status !== 'cancelled' && (
                      <button onClick={() => startEdit(r)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, marginRight: 6 }}>EDIT</button>
                    )}
                    {r.status !== 'cancelled' && canCancel && (
                      <button onClick={() => cancelSO(r)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, color: T.red, borderColor: T.red }}>CANCEL</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationBar {...pg} />
        </>
      )}

      {cancelTarget && (
        <ReasonDialog danger title={`CANCEL ${cancelTarget.r.soNumber || 'SALES ORDER'}`}
          message={
            `The sales order keeps its number and is marked cancelled.` +
            (cancelTarget.theDO ? `\nDelivery order ${cancelTarget.theDO.brNo} is marked cancelled too.` : '') +
            (cancelTarget.theBAST ? `\nBAST ${cancelTarget.theBAST.nomorBast} is marked cancelled too.` : '') +
            `\n\nNothing is deleted. This cannot be undone from the app.`}
          placeholder="e.g. Client cancelled PO — vessel changed schedule"
          confirmLabel="CANCEL SALES ORDER"
          onConfirm={doCancel} onCancel={() => setCancelTarget(null)} />
      )}

      {ftError && (
        <div style={{ marginTop: 16, fontSize: 10, color: T.textFaint }}>
          Note: couldn't load fuel types from FuelOps ({ftError}). Fuel type falls back to manual entry.
        </div>
      )}
    </div>
  );
}
