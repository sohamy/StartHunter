/**
 * 공개 시트 단말 — 주소 하나로 캐릭터 한 명을 보여준다.
 *
 * `/battle/sheet/?id=활동명` 으로 연다. 운영진이 이 주소를 커뮤니티에 남기면
 * 참가자들이 서로의 설정을 읽을 수 있다.
 *
 * 여기에 뜨는 값은 store 의 공개 경계(toPublicProfile · public_profiles 뷰)를
 * 이미 거친 것이다 — 스탯도 스킬 수치도 애초에 내려오지 않는다.
 */

import { useEffect, useState } from 'react';

import { getAuth, getStorage, isServerMode, type PublicProfile } from '../store';
import { PublicSheetCard } from './SheetView';

type Phase = 'LOADING' | 'READY' | 'NO_ID' | 'NOT_FOUND' | 'NEED_LOGIN';

function joinUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/battle/join/`;
}

function homeUrl(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
}

/** 주소에서 활동명을 꺼낸다. `?id=` 와 `?handle=` 을 모두 받는다. */
function readHandle(): string {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return (params.get('id') ?? params.get('handle') ?? '').trim();
}

export default function PublicSheetTerminal() {
  const [phase, setPhase] = useState<Phase>('LOADING');
  const [handle, setHandle] = useState('');
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  /** 관리국이 맺어 준 상대 — 시트에 적어 둔 이름보다 우선한다 */
  const [bondedName, setBondedName] = useState<string | null>(null);
  const [squad, setSquad] = useState<string | null>(null);

  useEffect(() => {
    const target = readHandle();
    setHandle(target);
    if (!target) {
      setPhase('NO_ID');
      return;
    }

    let cancelled = false;
    (async () => {
      const auth = getAuth();

      // 공개 시트도 로그인한 참가자에게만 연다 — 외부에 그대로 노출하지 않는다.
      if (isServerMode() && !(await auth.currentSession())) {
        if (!cancelled) setPhase('NEED_LOGIN');
        return;
      }

      const found = await auth.getPublicProfile(target);
      if (cancelled) return;
      if (!found) {
        setPhase('NOT_FOUND');
        return;
      }
      setProfile(found);
      setPhase('READY');

      // 편성은 있으면 좋고 없어도 그만이다 — 실패해도 시트는 그대로 보여준다
      try {
        const bonds = await getStorage().listBonds();
        const mine = bonds.find(
          (row) =>
            row.active &&
            (row.hunterAccountId === target || row.constellationAccountId === target),
        );
        if (cancelled || !mine) return;
        setSquad(mine.label);
        setBondedName(
          mine.hunterAccountId === target ? mine.constellationName : mine.hunterName,
        );
      } catch {
        /* 편성 조회 실패는 무시한다 */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === 'LOADING') {
    return <div className="console-loading">LOADING PUBLIC SHEET…</div>;
  }

  return (
    <div className="console">
      <header className="console-head">
        <div className="agency">
          <b>HUNTER MANAGEMENT AGENCY</b>
          <span>PUBLIC SHEET · 공개 시트</span>
        </div>
        <div className="btn-row">
          <a className="ctl" href={joinUrl()}>
            내 시트 보기
          </a>
        </div>
      </header>

      {phase === 'READY' && profile && (
        <section className="panel">
          <h2 className="panel-title">
            {profile.name}
            {squad && <span className="tag ok" style={{ marginLeft: 10 }}>{squad}</span>}
          </h2>
          <p className="hint" style={{ marginBottom: 14 }}>
            공개 등록 정보입니다. 스탯과 스킬 수치는 관리국(운영진)만 열람합니다.
          </p>
          <PublicSheetCard profile={profile} partnerName={bondedName} />
        </section>
      )}

      {phase === 'NO_ID' && (
        <section className="panel">
          <h2 className="panel-title">주소가 비어 있습니다</h2>
          <p className="hint">
            공개 시트는 <code>?id=활동명</code> 형태의 주소로 엽니다. 운영진이 남긴 주소를 그대로
            열어 주세요.
          </p>
        </section>
      )}

      {phase === 'NOT_FOUND' && (
        <section className="panel">
          <h2 className="panel-title">시트를 찾지 못했습니다</h2>
          <p className="hint">
            <b>{handle}</b> 으로 등록된 캐릭터가 없습니다. 활동명을 다시 확인해 주세요.
          </p>
        </section>
      )}

      {phase === 'NEED_LOGIN' && (
        <section className="panel">
          <h2 className="panel-title">로그인이 필요합니다</h2>
          <p className="hint" style={{ marginBottom: 12 }}>
            공개 시트는 등록을 마친 참가자끼리만 볼 수 있습니다. 접속한 뒤 이 주소를 다시 열어
            주세요.
          </p>
          <a className="confirm-btn" href={joinUrl()}>
            로그인하러 가기
            <small>계약 등록 단말로 이동</small>
          </a>
        </section>
      )}

      <footer className="console-foot">
        <span>HUNTER MANAGEMENT AGENCY · PUBLIC SHEET</span>
        <a href={homeUrl()}>← 세계관 소개 페이지</a>
      </footer>
    </div>
  );
}
