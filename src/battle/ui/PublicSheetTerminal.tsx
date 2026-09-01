/**
 * 공개 시트 단말 — 주소 하나로 캐릭터 한 명을 보여준다.
 *
 * `/battle/sheet/?id=활동명` 으로 연다. 운영진이 이 주소를 커뮤니티에 남기면
 * **로그인하지 않아도** 누구나 읽는다 — 링크 하나로 캐릭터를 보여주는 것이 목적이다.
 *
 * 제출한 시트 내용이 전부 실린다 — 성격 · 특징 · 계약 경위 · 스킬 · 스탯 · 환산 수치.
 * 계정 정보(로그인 · 포인트 · 전투 기록)는 담기지 않는다.
 */

import { useEffect, useState } from 'react';

import { getAuth, getStorage, loadShopCatalog, type PublicProfile } from '../store';
import { ProfileCard, PublicSheetCard } from './SheetView';
import Collapsible from './Collapsible';
import TerminalNav from './TerminalNav';

type Phase = 'LOADING' | 'READY' | 'NO_ID' | 'NOT_FOUND';

function homeUrl(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
}

/** 명부 게시판 — 이 사람 말고 다른 참가자도 보려는 사람에게 준다 */
function boardUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/battle/board/`;
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
      // 가방에 운영진이 만든 품목이 들어 있을 수 있다
      await loadShopCatalog();
      const auth = getAuth();

      // 로그인하지 않아도 읽는다 — 이 주소는 커뮤니티에 그대로 붙이는 용도다.
      // 서버 쪽도 public_profiles 를 anon 에게 열어 두었다 (0014).
      const found = await auth.getPublicProfile(target);
      if (cancelled) return;
      if (!found) {
        setPhase('NOT_FOUND');
        return;
      }
      setProfile(found);
      setPhase('READY');

      // 편성은 로그인한 사람만 읽을 수 있다. 없으면 시트에 적힌 값으로 채운다.
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
      <TerminalNav current="public-sheet" />
      <header className="console-head">
        <div className="agency">
          <b>HUNTER MANAGEMENT AGENCY</b>
          <span>PUBLIC SHEET · 공개 시트</span>
        </div>
        {/* 명부에서 들어오지 않고 링크로 바로 온 사람도 있다 — 목록으로 가는 길을 둔다 */}
        <a className="ctl" href={boardUrl()}>
          ← 명부 게시판
        </a>
      </header>

      {phase === 'READY' && profile && (
        <section className="panel">
          <h2 className="panel-title">
            {profile.name}
            {squad && <span className="tag ok" style={{ marginLeft: 10 }}>{squad}</span>}
          </h2>
          <p className="hint" style={{ marginBottom: 14 }}>
            프로필 카드입니다. 제출한 시트 전문은 카드 아래에서 펼칩니다.
          </p>
          <ProfileCard profile={profile} squad={squad} partnerName={bondedName} />

          <div style={{ marginTop: 12 }}>
            <Collapsible label="시트 전문 — 성격 · 특징 · 계약 경위 · 스킬 · 스탯 · 보급">
              <PublicSheetCard
                profile={profile}
                partnerName={bondedName}
                supply={{ points: profile.points, inventory: profile.inventory }}
              />
            </Collapsible>
          </div>
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

      <footer className="console-foot">
        <span>HUNTER MANAGEMENT AGENCY · PUBLIC SHEET</span>
        <a href={homeUrl()}>← 세계관 소개 페이지</a>
      </footer>
    </div>
  );
}
