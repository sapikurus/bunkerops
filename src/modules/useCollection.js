import { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore';

// Firestore rejects `undefined` field values. Strip them (and recurse into
// plain objects/arrays) so no write ever crashes on an undefined field.
function clean(v) {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined) continue;
      out[k] = clean(val);
    }
    return out;
  }
  return v;
}

// Live subscription to a Firestore collection + CRUD helpers.
// Returns { data, loading, add, update, remove }.
export function useCollection(colName) {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, colName), snap => {
      setData(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, err => {
      console.error(`useCollection(${colName})`, err);
      setLoading(false);
    });
    return unsub;
  }, [colName]);

  const add    = (obj)      => addDoc(collection(db, colName), { ...clean(obj), createdAt: serverTimestamp() });
  const update = (id, obj)  => updateDoc(doc(db, colName, id), clean(obj));
  const remove = (id)       => deleteDoc(doc(db, colName, id));

  return { data, loading, add, update, remove };
}
