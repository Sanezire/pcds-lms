const ICONS = {
  edit: '/images/edit_icon.png',
  delete: '/images/delete_icon.png',
};

// Square icon-only button for Edit and Delete. `label` is read by screen readers.
export default function IconButton({ kind, label, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`icon-btn icon-btn-${kind} ${className}`.trim()}
      aria-label={label}
      title={label}
      {...props}
    >
      <img src={ICONS[kind]} alt="" />
    </button>
  );
}
