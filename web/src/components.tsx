// components.tsx - tiny reusable bits so every screen looks and behaves the same.
import type { ReactNode } from 'react';
import type { BookingStatus } from './api';

export function Loading() {
  return <p className="muted">Loading…</p>;
}

// kind decides the colour: red error, green success, blue info.
export function Message({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
  if (!children) return null;          // nothing to say -> render nothing
  return <div className={`msg msg-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function StatusBadge({ status }: { status: BookingStatus | string }) {
  return <span className={`badge badge-${status}`}>{status.replace('_', ' ')}</span>;
}
