import QRCode from 'qrcode';

// Base URL for verification links (the deployed app origin).
export function verifyUrl(docType, docId) {
  const origin = window.location.origin;
  return `${origin}/verify/${docType}/${docId}`;
}

// Generate a QR code (as a PNG data URL) that encodes the verify URL.
export async function makeQR(docType, docId) {
  const url = verifyUrl(docType, docId);
  return QRCode.toDataURL(url, { margin: 1, width: 200, errorCorrectionLevel: 'M' });
}
