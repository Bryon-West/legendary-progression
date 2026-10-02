import { useEffect, useId, useRef, type ReactNode, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

let locks = 0;
let savedY = 0;
function lockScroll() {
  if (locks++ === 0) {
    savedY = window.scrollY;
    const b = document.body.style;
    b.position = 'fixed'; b.top = `-${savedY}px`; b.left = '0'; b.right = '0'; b.width = '100%'; b.overflow = 'hidden';
  }
}
function unlockScroll() {
  if (--locks === 0) {
    const b = document.body.style;
    b.position = ''; b.top = ''; b.left = ''; b.right = ''; b.width = ''; b.overflow = '';
    window.scrollTo(0, savedY);
  }
}
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    lockScroll();
    panel.current?.focus();
    return () => {
      unlockScroll();
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closeRef.current(); return; }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0]; const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };
  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <section ref={panel} tabIndex={-1} className="modal enter" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <h2 id={titleId} style={{ margin: 0, fontSize: 20 }}>{title}</h2>
          <button type="button" className="btn btn-ghost" aria-label="Close dialog" onClick={close} style={{ minHeight: 40, padding: 8 }}><X size={20}/></button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}
