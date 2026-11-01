import { useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { REPORT_CHOOSER_ROLES } from '../auth/roles.js';
import { downloadReport } from '../reportDownload.js';
import { DownloadIcon } from './Icons.jsx';
import ExportChoiceDialog from './ExportChoiceDialog.jsx';

// The Export button in a chart's detail view. It offers a PDF or a CSV of what the
// chart currently shows. `filters` are the options selected on screen, or null while
// there is nothing to export yet. `choices` (only the program and year level chart)
// lets admins and super admins pick what is printed before the file is made.
export default function ExportMenu({ chart, filters, choices = null }) {
  const { user } = useAuth();
  const menuId = useId();
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null); // 'pdf' | 'csv' | null
  const [asking, setAsking] = useState(null); // the format the choice dialog is for

  const canChoose = Boolean(choices) && REPORT_CHOOSER_ROLES.includes(user.role);
  const unavailable = !filters || Boolean(busy);

  useEffect(() => {
    if (!open) return undefined;
    const first = rootRef.current?.querySelector('[role="menuitem"]');
    first?.focus();
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function run(format, selection) {
    setBusy(format);
    await downloadReport({ chart, format, filters: { ...filters, ...selection } });
    setBusy(null);
  }

  function pick(format) {
    setOpen(false);
    if (canChoose) setAsking(format);
    else run(format);
  }

  function onMenuKey(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...rootRef.current.querySelectorAll('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next].focus();
  }

  return (
    <div className="export-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-quiet export-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={unavailable}
        title={filters ? undefined : 'Nothing to export yet'}
        onClick={() => setOpen((o) => !o)}
      >
        <DownloadIcon width={18} height={18} />
        {busy ? 'Preparing…' : 'Export'}
        <span aria-hidden="true" className="export-caret">▾</span>
      </button>
      {open && (
        <ul className="export-list" id={menuId} role="menu" onKeyDown={onMenuKey}>
          <li role="none">
            <button type="button" role="menuitem" className="export-item" onClick={() => pick('pdf')}>
              <strong>PDF</strong>
              <span className="muted">Chart, table and filters, ready to print</span>
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" className="export-item" onClick={() => pick('csv')}>
              <strong>CSV</strong>
              <span className="muted">The table data, for a spreadsheet</span>
            </button>
          </li>
        </ul>
      )}
      {asking && (
        <ExportChoiceDialog
          format={asking}
          choices={choices}
          onClose={() => setAsking(null)}
          onConfirm={(selection) => {
            setAsking(null);
            run(asking, selection);
          }}
        />
      )}
    </div>
  );
}
