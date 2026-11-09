import { download } from './api.js';
import { showErrorToast, showSuccessToast } from './toast.js';

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Asks the server for an analytics report and saves the file. The server checks
// every option and builds the report from the attendance data.
// Resolves to true when the file was saved.
export async function downloadReport({ chart, format, filters }) {
  try {
    const { blob, filename } = await download('/reports/analytics', {
      method: 'POST',
      body: { chart, format, ...(filters ? { filters } : {}) },
    });
    saveBlob(blob, filename);
    showSuccessToast('Report ready', filename);
    return true;
  } catch (err) {
    showErrorToast('Could not export', err.message);
    return false;
  }
}
