import { useEffect, useId, useRef, useState } from 'react';
import Modal from './Modal.jsx';

// A "Select all" box that shows a dash when only some of the list is ticked.
function SelectAll({ total, count, onChange, label }) {
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && count < total;
  }, [count, total]);
  return (
    <label htmlFor={id} className="choice-all">
      <input id={id} ref={ref} type="checkbox" checked={total > 0 && count === total} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Select all <span className="muted">({count} of {total} {label} selected)</span>
      </span>
    </label>
  );
}

function ChoiceGroup({ legend, label, items, selected, setSelected }) {
  const toggle = (value) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  return (
    <fieldset className="choice-group">
      <legend>{legend}</legend>
      <SelectAll
        total={items.length}
        count={selected.size}
        label={label}
        onChange={(on) => setSelected(on ? new Set(items.map((i) => i.value)) : new Set())}
      />
      <ul className="choice-list">
        {items.map((i) => (
          <li key={i.value}>
            <label className="choice-item">
              <input type="checkbox" checked={selected.has(i.value)} onChange={() => toggle(i.value)} />
              <span>{i.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

// Asks which academic programs and year levels go into the report. Everything
// starts selected, so confirming straight away prints all of them.
export default function ExportChoiceDialog({ format, choices, onConfirm, onClose }) {
  const programItems = choices.programs.map((p) => ({ value: p, label: p }));
  const [programs, setPrograms] = useState(() => new Set(choices.programs));
  const [years, setYears] = useState(() => new Set(choices.years.map((y) => y.value)));

  const nothing = programs.size === 0 || years.size === 0;
  const everyProgram = programs.size === choices.programs.length;
  const everyYear = years.size === choices.years.length;

  function confirm() {
    if (nothing) return;
    // Sending nothing means "all", so a report with everything chosen follows the data as it is.
    onConfirm({
      ...(everyProgram ? {} : { programs: choices.programs.filter((p) => programs.has(p)) }),
      ...(everyYear ? {} : { yearLevels: choices.years.filter((y) => years.has(y.value)).map((y) => y.value) }),
    });
  }

  return (
    <Modal title="Choose what to include" onClose={onClose} className="modal-wide">
      <p className="modal-note">
        Everything is selected. Untick any academic program or year level you do not want in the {format.toUpperCase()}.
        Percentages in the report are worked out over what you keep.
      </p>
      <div className="choice-columns">
        <ChoiceGroup legend="Academic programs" label="programs" items={programItems} selected={programs} setSelected={setPrograms} />
        <ChoiceGroup legend="Year levels" label="year levels" items={choices.years} selected={years} setSelected={setYears} />
      </div>
      <p className="choice-hint" role="status">
        {nothing ? 'Select at least one academic program and one year level to continue.' : ''}
      </p>
      <div className="modal-actions">
        <button type="button" className="btn btn-quiet btn-lg" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary btn-lg" onClick={confirm} disabled={nothing}>
          Export {format.toUpperCase()}
        </button>
      </div>
    </Modal>
  );
}
