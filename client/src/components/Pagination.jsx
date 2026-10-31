const PAGE_SIZES = [10, 25, 50, 100];

// Page numbers to show: first, last, and a few around the current page, with
// gaps marked by null so a long list stays compact.
function pageList(current, total) {
  const wanted = new Set([1, total, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((n) => wanted.add(n));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((n) => wanted.add(n));
  const nums = [...wanted].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}

export default function Pagination({ page, totalPages, pageSize, total, onPage, onPageSize, label = 'Pages' }) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <nav className="pager" aria-label={label}>
      <p className="muted pager-info" role="status">
        Showing {first}–{last} of {total}
      </p>
      <div className="pager-controls">
        <label className="pager-size">
          <span>Rows per page</span>
          <select className="field-select" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="pager-pages">
          <button type="button" className="btn btn-quiet" onClick={() => onPage(page - 1)} disabled={page <= 1}>
            Previous
          </button>
          {pageList(page, totalPages).map((n, i) =>
            n === null ? (
              <span key={`gap-${i}`} className="pager-gap" aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                className={`btn btn-quiet pager-num${n === page ? ' is-current' : ''}`}
                onClick={() => onPage(n)}
                aria-current={n === page ? 'page' : undefined}
                aria-label={`Page ${n}`}
              >
                {n}
              </button>
            )
          )}
          <button type="button" className="btn btn-quiet" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>
            Next
          </button>
        </div>
      </div>
    </nav>
  );
}
