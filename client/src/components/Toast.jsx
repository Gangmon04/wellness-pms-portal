import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import './Toast.css';

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

const ICONS = {
  error: 'ti-alert-circle',
  success: 'ti-check',
  warning: 'ti-alert-triangle',
  info: 'ti-info-circle'
};

const DEFAULT_TITLES = {
  error: 'Action Failed',
  success: 'Success',
  warning: 'Attention',
  info: 'Notice'
};

function ToastItem({ id, type = 'info', title, message, duration = 4500, onRemove }) {
  const [exiting, setExiting] = useState(false);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      onRemove(id);
    }, 250);
  }, [id, onRemove]);

  useEffect(() => {
    if (!duration) return;
    const timer = setTimeout(dismiss, duration);
    return () => clearTimeout(timer);
  }, [duration, dismiss]);

  const iconClass = ICONS[type] || ICONS.info;
  const displayTitle = title !== undefined ? title : DEFAULT_TITLES[type];

  return (
    <div
      className={`toast toast-${type}${exiting ? ' toast-exit' : ''}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="toast-icon">
        <i className={`ti ${iconClass}`}></i>
      </div>
      <div className="toast-content">
        {displayTitle && <div className="toast-title">{displayTitle}</div>}
        <div className="toast-message">{message}</div>
      </div>
      <button
        type="button"
        className="toast-close"
        onClick={dismiss}
        aria-label="Dismiss notification"
      >
        <i className="ti ti-x"></i>
      </button>
    </div>
  );
}

let toastCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message, type = 'info', options = {}) => {
    const id = ++toastCounter;
    const { title, duration = 4500 } = typeof options === 'number'
      ? { duration: options }
      : (typeof options === 'string' ? { title: options } : options);

    setToasts((prev) => [...prev, { id, type, message, title, duration }]);
    return id;
  }, []);

  const toast = {
    show: showToast,
    error: (msg, options) => showToast(msg, 'error', options),
    success: (msg, options) => showToast(msg, 'success', options),
    warning: (msg, options) => showToast(msg, 'warning', options),
    info: (msg, options) => showToast(msg, 'info', options),
    remove: removeToast
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} {...t} onRemove={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export default ToastProvider;
