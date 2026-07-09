import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';

// Reads FuelOps's shared master data from the `app/data` document in the same
// Firebase project. Single source of truth for fuel types (no duplication).
// Fails gracefully: if the doc or field is missing, returns empty + an error flag
// so the UI can fall back to manual entry rather than crashing.
export function useFuelOpsMaster() {
  const [fuelTypes, setFuelTypes] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'app', 'data'),
      snap => {
        if (snap.exists()) {
          const d = snap.data();
          setFuelTypes(Array.isArray(d.fuelTypes) ? d.fuelTypes : []);
          setError(null);
        } else {
          setError('FuelOps app/data document not found.');
        }
        setLoading(false);
      },
      err => { setError(err.message); setLoading(false); }
    );
    return unsub;
  }, []);

  return { fuelTypes, loading, error };
}
