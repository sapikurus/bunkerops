import { useState } from 'react';
import { s } from '../tokens';

// Number input that displays thousand separators (id-ID: 398.400) when not focused,
// but lets you type raw digits while focused so the cursor never jumps.
// Value is stored/returned as a raw number string (no separators).
export default function VolumeInput({ value, onChange, style, placeholder, disabled }) {
  const [focused, setFocused] = useState(false);

  const raw = value == null ? '' : String(value);
  const formatted = raw === '' ? ''
    : (Number(raw.replace(/[^\d.-]/g, '')) || 0).toLocaleString('id-ID');

  const handle = (e) => {
    // keep only digits (and a leading minus) — strip any separators the user pastes
    const cleaned = e.target.value.replace(/[^\d-]/g, '');
    onChange(cleaned);
  };

  return (
    <input
      style={{ ...s.input, textAlign: 'right', fontFamily: "'DM Mono', monospace", ...style }}
      value={focused ? raw : formatted}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={handle}
      placeholder={placeholder}
      disabled={disabled}
      inputMode="numeric"
    />
  );
}
