/**
 * 접이식 상세.
 *
 * 화면에 항상 두기엔 긴 정보(시트 · 수치 편집 · 지난 기록)를 접어 둔다.
 * 참가자 단말과 운영진 작전실이 같은 것을 쓴다.
 */

import { useState, type ReactNode } from 'react';

export default function Collapsible({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`collapse ${open ? 'open' : ''}`}>
      <button type="button" className="collapse-head" onClick={() => setOpen(!open)}>
        <span>{label}</span>
        <i aria-hidden="true">{open ? '−' : '+'}</i>
      </button>
      {open && <div className="collapse-body">{children}</div>}
    </div>
  );
}
