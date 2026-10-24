import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '../api.js';
import { Field } from './Field.jsx';

const MAX = 500;

function MessageBox({ label, value, onChange, error, id }) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        className="field-textarea"
        rows={3}
        maxLength={MAX}
        value={value}
        onChange={onChange}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
      />
      <div className="textarea-foot">
        {error ? (
          <p className="error-text" id={`${id}-err`}>
            {error}
          </p>
        ) : (
          <span />
        )}
        <span className="muted counter">
          {value.length}/{MAX}
        </span>
      </div>
    </div>
  );
}

function SendNow() {
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setStatus('');
    if (!text.trim()) {
      setError('Enter a message.');
      return;
    }
    setError('');
    setSending(true);
    try {
      await api('/messages/broadcast', { method: 'POST', body: { message: text } });
      setText('');
      setStatus('Sent. It will appear on the kiosk within a few seconds.');
    } catch (err) {
      setError(err.fields?.message || err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="msg-section">
      <h3>Send a message to the kiosk</h3>
      <p className="muted">Shows on the kiosk screen right away for 5 seconds, or until someone taps Proceed.</p>
      <MessageBox
        id={id}
        label="Message"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError('');
        }}
        error={error}
      />
      <div className="msg-actions">
        <span className="status-text" role="status">
          {status}
        </span>
        <button type="submit" className="btn btn-primary btn-lg" disabled={sending}>
          {sending ? 'Sending…' : 'Send to kiosk'}
        </button>
      </div>
    </form>
  );
}

function IdMessages() {
  const inId = useId();
  const outId = useId();
  const formRef = useRef(null);
  const [rules, setRules] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(null); // rule being edited, or null when adding
  const [studentId, setStudentId] = useState('');
  const [message, setMessage] = useState('');
  const [messageOut, setMessageOut] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api('/messages/rules');
      setRules(data.rules);
      setLoadError('');
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setEditing(null);
    setStudentId('');
    setMessage('');
    setMessageOut('');
    setErrors({});
    setFormError('');
  }

  function startEdit(rule) {
    setEditing(rule);
    setStudentId(rule.studentId);
    setMessage(rule.message);
    setMessageOut(rule.messageOut);
    setErrors({});
    setFormError('');
    formRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function onSubmit(e) {
    e.preventDefault();
    setFormError('');
    const found = {};
    if (!editing && !studentId.trim()) found.studentId = 'Enter a student ID.';
    if (!message.trim() && !messageOut.trim()) found.message = 'Enter a Time In message, a Time Out message, or both.';
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    try {
      if (editing) {
        await api(`/messages/rules/${editing.id}`, { method: 'PATCH', body: { message, messageOut } });
      } else {
        await api('/messages/rules', { method: 'POST', body: { studentId, message, messageOut } });
      }
      resetForm();
      await load();
    } catch (err) {
      setFormError(err.message);
      setErrors(err.fields || {});
    } finally {
      setSaving(false);
    }
  }

  async function toggle(rule) {
    setBusyId(rule.id);
    try {
      await api(`/messages/rules/${rule.id}`, { method: 'PATCH', body: { enabled: !rule.enabled } });
      await load();
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(rule) {
    if (!window.confirm(`Delete the messages for ID ${rule.studentId}?`)) return;
    setBusyId(rule.id);
    try {
      await api(`/messages/rules/${rule.id}`, { method: 'DELETE' });
      if (editing?.id === rule.id) resetForm();
      await load();
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="msg-section">
      <h3>Messages for specific IDs</h3>
      <p className="muted">When one of these IDs is scanned, the kiosk shows the Time In or Time Out message after recording attendance.</p>

      <form onSubmit={onSubmit} noValidate ref={formRef} className="rule-form">
        {formError && (
          <div className="alert alert-error" role="alert">
            {formError}
          </div>
        )}
        <Field
          label="Student ID"
          name="ruleStudentId"
          autoComplete="off"
          value={studentId}
          onChange={(e) => {
            setStudentId(e.target.value);
            setErrors((er) => ({ ...er, studentId: undefined }));
          }}
          disabled={Boolean(editing)}
          error={errors.studentId}
        />
        <MessageBox
          id={inId}
          label="Time In message"
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setErrors((er) => ({ ...er, message: undefined }));
          }}
          error={errors.message}
        />
        <MessageBox
          id={outId}
          label="Time Out message"
          value={messageOut}
          onChange={(e) => {
            setMessageOut(e.target.value);
            setErrors((er) => ({ ...er, messageOut: undefined }));
          }}
          error={errors.messageOut}
        />
        <p className="hint form-hint">Fill in one or both. Leave one empty to show nothing on that scan.</p>
        <div className="msg-actions">
          {editing && (
            <button type="button" className="btn btn-quiet btn-lg" onClick={resetForm}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add message'}
          </button>
        </div>
      </form>

      {loadError && (
        <div className="alert alert-error" role="alert">
          {loadError}
        </div>
      )}
      {!rules && !loadError && <p className="muted">Loading messages…</p>}
      {rules && rules.length === 0 && <p className="empty">No ID messages yet.</p>}
      {rules && rules.length > 0 && (
        <ul className="rule-list">
          {rules.map((r) => (
            <li key={r.id} className={`rule${r.enabled ? '' : ' is-off'}`}>
              <div className="rule-body">
                <span className="rule-id">{r.studentId}</span>
                {r.message && (
                  <span className="rule-text">
                    <span className="rule-tag">Time In</span> {r.message}
                  </span>
                )}
                {r.messageOut && (
                  <span className="rule-text">
                    <span className="rule-tag">Time Out</span> {r.messageOut}
                  </span>
                )}
              </div>
              <div className="rule-actions">
                <label className="rule-switch">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    disabled={busyId === r.id}
                    onChange={() => toggle(r)}
                  />
                  <span>{r.enabled ? 'On' : 'Off'}</span>
                </label>
                <button type="button" className="btn btn-quiet" onClick={() => startEdit(r)}>
                  Edit
                </button>
                <button type="button" className="btn btn-quiet btn-danger" onClick={() => remove(r)} disabled={busyId === r.id}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MessageConfiguration() {
  return (
    <section className="panel" aria-labelledby="msgcfg-h">
      <div className="panel-head">
        <div>
          <h2 id="msgcfg-h">Message Configuration</h2>
          <p className="muted">Messages appear on the kiosk as a pop-up for 5 seconds.</p>
        </div>
      </div>
      <SendNow />
      <IdMessages />
    </section>
  );
}
