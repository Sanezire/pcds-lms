import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '../api.js';
import { useLiveReload } from '../live.js';
import { Field } from './Field.jsx';
import Modal from './Modal.jsx';

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

const sentFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// Every message sent to the kiosk, with delete and delete all. Messages for
// specific IDs are managed in their own section and are not listed here.
function SentMessages({ onClose }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api('/messages/broadcasts');
      setItems(data.broadcasts);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // New sends, and deletes made from another screen, show up while this is open.
  useLiveReload(['messages'], load);

  async function remove(item) {
    setBusyId(item.id);
    setError('');
    try {
      await api(`/messages/broadcasts/${item.id}`, { method: 'DELETE' });
      setItems((list) => (list ? list.filter((m) => m.id !== item.id) : list));
    } catch (err) {
      // Already gone (for example deleted on another screen): just refresh.
      if (err.status !== 404) setError(err.message);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function removeAll() {
    setClearing(true);
    setError('');
    try {
      await api('/messages/broadcasts', { method: 'DELETE' });
      setItems([]);
      setConfirmAll(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setClearing(false);
    }
  }

  const count = items?.length || 0;

  return (
    <Modal title="Messages sent to the kiosk" onClose={onClose}>
      <p className="modal-note">Direct messages only. Messages for specific IDs are not listed here.</p>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {!items && !error && <p className="muted">Loading messages…</p>}
      {items && count === 0 && <p className="empty">No messages have been sent to the kiosk.</p>}
      {count > 0 && (
        <ul className="sent-list">
          {items.map((m) => (
            <li key={m.id} className="sent-item">
              <div className="sent-body">
                <span className="sent-text">{m.text}</span>
                <span className="muted sent-time">{sentFormat.format(new Date(m.sentAt))}</span>
              </div>
              <button
                type="button"
                className="btn btn-quiet btn-danger"
                onClick={() => remove(m)}
                disabled={busyId === m.id || clearing}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        {confirmAll ? (
          <>
            <span className="sent-confirm" role="alert">
              Delete all {count} {count === 1 ? 'message' : 'messages'}?
            </span>
            <button type="button" className="btn btn-quiet btn-lg" onClick={() => setConfirmAll(false)} disabled={clearing}>
              Keep them
            </button>
            <button type="button" className="btn btn-primary btn-lg btn-danger-solid" onClick={removeAll} disabled={clearing}>
              {clearing ? 'Deleting…' : 'Yes, delete all'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-quiet btn-lg" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-lg btn-danger"
              onClick={() => setConfirmAll(true)}
              disabled={count === 0}
            >
              Delete all
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

function SendNow() {
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);
  const [showSent, setShowSent] = useState(false);

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
        <button type="button" className="btn btn-quiet btn-lg" onClick={() => setShowSent(true)}>
          View sent messages
        </button>
        <button type="submit" className="btn btn-primary btn-lg" disabled={sending}>
          <img className="btn-icon" src="/images/add_message_icon.png" alt="" />
          {sending ? 'Sending…' : 'Send to kiosk'}
        </button>
      </div>
      {showSent && <SentMessages onClose={() => setShowSent(false)} />}
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

  useLiveReload(['messages'], load);

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
            {!editing && <img className="btn-icon" src="/images/add_message_icon.png" alt="" />}
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
          <h2 id="msgcfg-h" className="title-with-icon">
            <img className="title-icon" src="/images/message_configuration_icon.png" alt="" />
            Message Configuration
          </h2>
          <p className="muted">Messages appear on the kiosk as a pop-up for 5 seconds.</p>
        </div>
      </div>
      <SendNow />
      <IdMessages />
    </section>
  );
}
