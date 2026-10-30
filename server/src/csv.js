// Minimal CSV reader (RFC 4180): quoted fields, doubled quotes, commas and line
// breaks inside quotes, CRLF or LF, and a leading byte-order mark.
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.some((c) => c.trim() !== '')) rows.push({ line: rowLine, cells: row });
    row = [];
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') endField();
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      endRow();
      line += 1;
      rowLine = line;
    } else field += ch;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}
