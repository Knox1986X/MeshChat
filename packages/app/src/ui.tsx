import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { hash } from '../../core/src/sodium';
import { bytes } from './format';
import { Icon } from './icons';

// ------------------------------------------------------------- identicon ---

const FALLBACK = new Uint8Array(32).map((_, i) => (i * 37) % 255);

export function Identicon({ seed, size = 40, className = '' }: { seed: string; size?: number; className?: string }) {
  const { cells, hue } = useMemo(() => {
    let digest = FALLBACK;
    try {
      digest = hash('meshchat/identicon/v1', seed);
    } catch {
      /* crypto not ready yet */
    }
    const grid: boolean[] = [];
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 3; x++) grid.push((digest[y * 3 + x] & 1) === 1);
    }
    const full: boolean[] = [];
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const mx = x < 3 ? x : 4 - x;
        full.push(grid[y * 3 + mx]);
      }
    }
    const hue = Math.round((digest[20] / 255) * 360);
    return { cells: full, hue };
  }, [seed]);

  return (
    <svg
      className={`identicon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 5 5"
      role="img"
      aria-label="identicon"
      style={{ ['--hue' as string]: hue }}
    >
      <rect width="5" height="5" fill="transparent" />
      {cells.map((on, i) =>
        on ? <rect key={i} x={i % 5} y={Math.floor(i / 5)} width="1" height="1" fill="currentColor" /> : null,
      )}
    </svg>
  );
}

export function Avatar({
  seed,
  name,
  size = 44,
  online,
  onClick,
}: {
  seed: string;
  name: string;
  size?: number;
  online?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <div className={`avatar ${onClick ? 'is-clickable' : ''}`} style={{ width: size, height: size }}>
      <div className="avatar-bg">
        <Identicon seed={seed} size={Math.round(size * 0.78)} />
      </div>
      {online !== undefined && <span className={`presence ${online ? 'is-on' : ''}`} />}
    </div>
  );
  if (!onClick) return <div title={name}>{content}</div>;
  return (
    <button type="button" className="avatar-button" onClick={onClick} title={name}>
      {content}
    </button>
  );
}

// ---------------------------------------------------------------- modal ----

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="muted small">{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- controls --

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`row toggle-row ${disabled ? 'is-disabled' : ''}`}>
      <span className="row-text">
        <span>{label}</span>
        {hint && <span className="muted small">{hint}</span>}
      </span>
      <input
        type="checkbox"
        className="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export function CopyButton({ value, label, onCopied }: { value: string; label?: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement('textarea');
      area.value = value;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
    setCopied(true);
    onCopied?.();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button type="button" className={`btn ghost small ${copied ? 'is-ok' : ''}`} onClick={copy}>
      <Icon name={copied ? 'check' : 'copy'} size={15} />
      {copied ? '✓' : label ?? 'copy'}
    </button>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  hint,
  mono,
  onEnter,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
  mono?: boolean;
  onEnter?: () => void;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className={`input ${mono ? 'mono' : ''}`}
        type={type}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) onEnter();
        }}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

export function FilePreview({ mime, data, name, size }: { mime: string; data: string; name: string; size: number }) {
  if (mime.startsWith('image/')) {
    return (
      <a className="file-image" href={`data:${mime};base64,${data}`} target="_blank" rel="noreferrer noopener">
        <img src={`data:${mime};base64,${data}`} alt={name} loading="lazy" />
      </a>
    );
  }
  return (
    <a className="file-chip" href={`data:${mime || 'application/octet-stream'};base64,${data}`} download={name}>
      <Icon name="download" size={18} />
      <span className="file-chip-name">{name}</span>
      <span className="muted small">{bytes(size)}</span>
    </a>
  );
}

export function StateTicks({ state }: { state: string }) {
  if (state === 'read') return <Icon name="doubleCheck" size={15} className="tick is-read" />;
  if (state === 'delivered') return <Icon name="doubleCheck" size={15} className="tick" />;
  if (state === 'sent') return <Icon name="check" size={15} className="tick" />;
  if (state === 'failed') return <span className="tick is-failed">!</span>;
  return <Icon name="clock" size={14} className="tick is-queued" />;
}
