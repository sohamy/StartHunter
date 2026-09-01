/**
 * 명부 게시판 — 등록된 캐릭터 전부를 목록으로 늘어놓고, 한 줄을 열면 시트 전문이 나온다.
 *
 * `/battle/board/` 로 연다. 공개 시트(`/battle/sheet/?id=활동명`)가 한 사람을 가리키는
 * 주소라면, 이쪽은 **전체를 훑는 입구**다. 로그인하지 않아도 읽는다 —
 * public_profiles 는 anon 에게 열려 있다 (0014).
 *
 * 목록은 게시판처럼 갈래로 나눈다 (전체 · 헌터 · 성좌 · 소속별). 고른 갈래와 열어 둔 글은
 * 주소에 남기므로, 특정 글을 그대로 복사해 붙일 수 있고 뒤로 가기도 목록으로 돌아온다.
 */

import { useEffect, useMemo, useState } from 'react';

import {
  affiliationLabel,
  PairCard,
  ProfileCard,
  PublicSheetCard,
  sideLabel,
} from './SheetView';
import Collapsible from './Collapsible';
import TerminalNav from './TerminalNav';
import { Portrait } from './PortraitField';
import { findClass } from '../config/characters';
import {
  getAccounts,
  getStorage,
  loadShopCatalog,
  type PublicPair,
  type PublicProfile,
} from '../store';
import type { ActorSide, Affiliation } from '../types';

/** 게시판 갈래 하나 — 목록을 무엇으로 걸러 내는지까지 여기에 적어 둔다 */
interface BoardDef {
  id: string;
  label: string;
  labelKo: string;
  note: string;
  /** 사람을 세우는 갈래인지, 편성을 세우는 갈래인지 */
  kind: 'PROFILE' | 'PAIR';
  accepts: (profile: PublicProfile) => boolean;
}

const BOARDS: BoardDef[] = [
  {
    id: 'all',
    label: 'ALL',
    labelKo: '전체 명부',
    note: '등록을 마친 계약자 전원입니다.',
    kind: 'PROFILE',
    accepts: () => true,
  },
  {
    id: 'pairs',
    label: 'PAIR',
    labelKo: '편성 페어',
    note: '관리국이 확정한 편성입니다. 한쪽을 누르면 그 사람의 카드로 넘어갑니다.',
    kind: 'PAIR',
    // 이 갈래는 사람이 아니라 편성을 세운다
    accepts: () => false,
  },
  {
    id: 'hunter',
    label: 'HUNTER',
    labelKo: '헌터 명부',
    note: '탑에 직접 오르는 쪽입니다.',
    kind: 'PROFILE',
    accepts: (profile) => profile.side === 'HUNTER',
  },
  {
    id: 'constellation',
    label: 'CONSTELLATION',
    labelKo: '성좌 명부',
    note: '헌터와 계약을 맺고 권능을 내리는 쪽입니다.',
    kind: 'PROFILE',
    accepts: (profile) => profile.side === 'CONSTELLATION',
  },
  {
    id: 'government',
    label: 'GOVERNMENT',
    labelKo: '관리국 소속',
    note: '관리국 소속으로 등록한 계약자입니다.',
    kind: 'PROFILE',
    accepts: (profile) => profile.affiliation === 'GOVERNMENT',
  },
  {
    id: 'guild',
    label: 'GUILD',
    labelKo: '민간 길드 소속',
    note: '민간 길드 소속으로 등록한 계약자입니다.',
    kind: 'PROFILE',
    accepts: (profile) => profile.affiliation === 'PRIVATE_GUILD',
  },
];

const DEFAULT_BOARD = BOARDS[0];

function findBoard(id: string | null): BoardDef {
  return BOARDS.find((board) => board.id === id) ?? DEFAULT_BOARD;
}

function baseUrl(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, '');
}

function homeUrl(): string {
  return baseUrl() || '/';
}

/** 한 사람만 담은 공개 시트 주소 — 커뮤니티에 그대로 붙이는 용도다 */
function sheetUrl(handle: string): string {
  return `${baseUrl()}/battle/sheet/?id=${encodeURIComponent(handle)}`;
}

/** 편성이 확정된 페어 — 로그인한 사람만 읽을 수 있다 */
interface BondInfo {
  label: string;
  partnerName: string;
}

/** 주소에 남겨 둔 화면 상태 */
interface Route {
  boardId: string;
  handle: string;
}

function readRoute(): Route {
  if (typeof window === 'undefined') return { boardId: DEFAULT_BOARD.id, handle: '' };
  const params = new URLSearchParams(window.location.search);
  return {
    boardId: findBoard(params.get('list')).id,
    handle: (params.get('id') ?? '').trim(),
  };
}

/**
 * 주소를 화면 상태에 맞춘다.
 *
 * 글을 열 때만 방문 기록을 쌓는다 — 갈래를 훑는 동작까지 기록에 남으면
 * 뒤로 가기를 여러 번 눌러야 소개 페이지로 돌아가게 된다.
 */
function writeRoute(route: Route, push: boolean): void {
  const params = new URLSearchParams();
  if (route.boardId !== DEFAULT_BOARD.id) params.set('list', route.boardId);
  if (route.handle) params.set('id', route.handle);
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ''}`;
  if (push) window.history.pushState({ board: true }, '', next);
  else window.history.replaceState({ board: true }, '', next);
}

/** 검색 대조용 문자열 — 이름 · 활동명 · 페어명 · 클래스를 한 줄로 만든다 */
function searchKey(profile: PublicProfile): string {
  const classDef = findClass(profile.side, profile.classId);
  return [
    profile.name,
    profile.accountId,
    profile.pairName,
    profile.partnerName,
    classDef?.label ?? '',
    classDef?.labelKo ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

/** 목록 정렬 — 헌터를 앞에 두고, 같은 진영은 이름 순으로 세운다 */
function compareProfiles(a: PublicProfile, b: PublicProfile): number {
  if (a.side !== b.side) return a.side === 'HUNTER' ? -1 : 1;
  return a.name.localeCompare(b.name, 'ko');
}

function sideTag(side: ActorSide): string {
  return side === 'HUNTER' ? 'blue' : 'gold';
}

function affiliationTag(affiliation: Affiliation): string {
  return affiliation === 'GOVERNMENT' ? 'ok' : 'warn';
}

export default function BoardTerminal() {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [bonds, setBonds] = useState<Record<string, BondInfo>>({});
  /** 공개 편성 — 로그인하지 않아도 읽힌다 (0020) */
  const [pairs, setPairs] = useState<PublicPair[]>([]);
  const [route, setRoute] = useState<Route>({ boardId: DEFAULT_BOARD.id, handle: '' });
  const [query, setQuery] = useState('');

  useEffect(() => {
    setRoute(readRoute());

    let cancelled = false;
    (async () => {
      // 가방에 운영진이 만든 품목이 들어 있을 수 있다 — 이름을 붙이려면 진열을 먼저 읽는다
      await loadShopCatalog();
      try {
        const rows = await getAccounts().listProfiles();
        if (cancelled) return;
        setProfiles([...rows].sort(compareProfiles));
      } catch {
        if (!cancelled) setFailed(true);
      }
      if (!cancelled) setLoading(false);

      // 편성 카드는 누구나 본다 — 뷰(public_pairs)로 읽는다
      try {
        const rows = await getStorage().listPublicPairs();
        if (!cancelled) setPairs(rows);
      } catch {
        /* 편성 조회 실패는 무시한다 — 명부는 그대로 선다 */
      }

      // 편성 라벨은 로그인한 사람만 읽는다. 못 읽으면 시트에 적힌 값으로 간다.
      try {
        const rows = await getStorage().listBonds();
        if (cancelled) return;
        const map: Record<string, BondInfo> = {};
        for (const bond of rows) {
          if (!bond.active) continue;
          if (bond.hunterAccountId) {
            map[bond.hunterAccountId] = {
              label: bond.label,
              partnerName: bond.constellationName,
            };
          }
          if (bond.constellationAccountId) {
            map[bond.constellationAccountId] = {
              label: bond.label,
              partnerName: bond.hunterName,
            };
          }
        }
        setBonds(map);
      } catch {
        /* 편성 조회 실패는 무시한다 */
      }
    })();

    // 뒤로 가기 · 앞으로 가기로도 목록과 글 사이를 오간다
    const onPop = () => setRoute(readRoute());
    window.addEventListener('popstate', onPop);

    return () => {
      cancelled = true;
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  const board = findBoard(route.boardId);

  /** 갈래별 개수 — 탭에 그대로 붙인다 */
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const def of BOARDS) {
      map[def.id] = def.kind === 'PAIR' ? pairs.length : profiles.filter(def.accepts).length;
    }
    return map;
  }, [profiles, pairs]);

  /** 활동명 → 프로필 — 편성 카드에 사진과 클래스를 붙이는 데 쓴다 */
  const byHandle = useMemo(() => {
    const map: Record<string, PublicProfile> = {};
    for (const profile of profiles) map[profile.accountId] = profile;
    return map;
  }, [profiles]);

  const listedPairs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return pairs;
    return pairs.filter((pair) =>
      [pair.label, pair.hunterName, pair.constellationName, pair.hunterHandle, pair.constellationHandle]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [pairs, query]);

  const listed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return profiles
      .filter(board.accepts)
      .filter((profile) => !needle || searchKey(profile).includes(needle));
  }, [profiles, board, query]);

  const opened = route.handle
    ? profiles.find((profile) => profile.accountId === route.handle) ?? null
    : null;

  /** 열어 둔 글이 이 갈래의 몇 번째인지 — 이전 글 · 다음 글 버튼이 이 자리를 쓴다 */
  const openedIndex = opened ? listed.findIndex((row) => row.accountId === opened.accountId) : -1;

  const go = (next: Route, push: boolean) => {
    setRoute(next);
    writeRoute(next, push);
  };

  const openPost = (handle: string) => {
    // 편성 갈래에는 사람 목록이 없다 — 사람을 열 때는 전체 명부로 옮겨야
    // 이전 글 · 다음 글이 이어진다
    go({ boardId: board.kind === 'PAIR' ? DEFAULT_BOARD.id : board.id, handle }, true);
    window.scrollTo({ top: 0 });
  };

  const closePost = () => {
    // 뒤로 가기(history.back)로 되감지 않는다 — 옆 글로 여러 번 넘어온 뒤에도
    // 이 버튼은 언제나 목록으로 가야 한다.
    go({ boardId: board.id, handle: '' }, true);
    window.scrollTo({ top: 0 });
  };

  const selectBoard = (id: string) => {
    go({ boardId: id, handle: '' }, false);
  };

  if (loading) {
    return <div className="console-loading">LOADING PUBLIC ROSTER…</div>;
  }

  return (
    <div className="console">
      <TerminalNav current="roster" />
      <header className="console-head">
        <div className="agency">
          <b>HUNTER MANAGEMENT AGENCY</b>
          <span>PUBLIC ROSTER · 명부 게시판</span>
        </div>
        <span className="tag">{profiles.length}명 등록</span>
      </header>

      {failed && (
        <p className="notice error">
          <b>조회 실패</b> — 명부를 읽지 못했습니다. 잠시 뒤에 다시 열어 주세요.
        </p>
      )}

      <section className="panel">
        <h2 className="panel-title">게시판 목록</h2>
        <p className="hint">
          갈래를 고르면 그 목록만 남습니다. 한 줄을 누르면 프로필 카드가 열리고, 시트 전문은
          카드 아래에서 펼칩니다.
        </p>
        <div className="board-tabs">
          {BOARDS.map((def) => (
            <button
              key={def.id}
              type="button"
              className={`chip-btn ${def.id === board.id ? 'on' : ''}`}
              onClick={() => selectBoard(def.id)}
            >
              <span>{def.labelKo}</span>
              <small>
                {def.label} · {counts[def.id] ?? 0}
                {def.kind === 'PAIR' ? '조' : '명'}
              </small>
            </button>
          ))}
        </div>
      </section>

      {opened ? (
        <section className="panel">
          <div className="board-post-head">
            <div>
              <span className="board-crumb">
                {board.labelKo} · {board.label}
              </span>
              <h2 className="panel-title" style={{ marginTop: 4 }}>
                {opened.name || '(이름 없음)'}
                {bonds[opened.accountId] && (
                  <span className="tag ok" style={{ marginLeft: 10 }}>
                    {bonds[opened.accountId].label}
                  </span>
                )}
              </h2>
              <p className="hint" style={{ margin: 0 }}>
                @{opened.accountId} · 프로필 카드입니다. 시트 전문은 아래에서 펼칩니다.
              </p>
            </div>
            <div className="btn-row">
              <button type="button" className="ctl" onClick={closePost}>
                ← 목록으로
              </button>
              <a className="ctl" href={sheetUrl(opened.accountId)}>
                이 시트만 따로 보기
              </a>
            </div>
          </div>

          <ProfileCard
            profile={opened}
            squad={bonds[opened.accountId]?.label ?? null}
            partnerName={bonds[opened.accountId]?.partnerName ?? null}
          />

          {/* 전문은 서류다 — 읽겠다고 한 사람에게만 펼친다 */}
          <div style={{ marginTop: 12 }}>
            <Collapsible label="시트 전문 — 성격 · 특징 · 계약 경위 · 스킬 · 스탯 · 보급">
              <PublicSheetCard
                profile={opened}
                partnerName={bonds[opened.accountId]?.partnerName ?? null}
                supply={{ points: opened.points, inventory: opened.inventory }}
              />
            </Collapsible>
          </div>

          {/* 목록으로 돌아가지 않고도 옆 글로 넘어가게 한다 */}
          <div className="board-nav">
            <button
              type="button"
              className="ctl"
              disabled={openedIndex <= 0}
              onClick={() => openPost(listed[openedIndex - 1].accountId)}
            >
              ← 이전 글
              {openedIndex > 0 && <span className="dim"> · {listed[openedIndex - 1].name}</span>}
            </button>
            <span className="dim small-text">
              {openedIndex >= 0 ? `${openedIndex + 1} / ${listed.length}` : '이 갈래 밖의 글'}
            </span>
            <button
              type="button"
              className="ctl"
              disabled={openedIndex < 0 || openedIndex >= listed.length - 1}
              onClick={() => openPost(listed[openedIndex + 1].accountId)}
            >
              {openedIndex >= 0 && openedIndex < listed.length - 1 && (
                <span className="dim">{listed[openedIndex + 1].name} · </span>
              )}
              다음 글 →
            </button>
          </div>
        </section>
      ) : (
        <section className="panel">
          <h2 className="panel-title">
            {board.labelKo}
            <span className="tag" style={{ marginLeft: 10 }}>
              {board.kind === 'PAIR' ? `${listedPairs.length}조` : `${listed.length}명`}
            </span>
          </h2>
          <p className="hint">{board.note}</p>

          <input
            className="ctl input sheet-search"
            type="search"
            value={query}
            placeholder={
              board.kind === 'PAIR'
                ? '페어 라벨 · 두 사람의 이름 검색'
                : '이름 · 활동명 · 페어명 · 클래스 검색'
            }
            onChange={(event) => setQuery(event.target.value)}
          />

          {board.kind === 'PAIR' ? (
            listedPairs.length === 0 ? (
              <p className="hint">
                {pairs.length === 0
                  ? '아직 확정된 편성이 없습니다. 편성은 관리국이 진행합니다.'
                  : '검색 조건에 맞는 편성이 없습니다.'}
              </p>
            ) : (
              <div className="card-grid">
                {listedPairs.map((pair) => (
                  <PairCard
                    key={pair.id}
                    pair={pair}
                    hunter={pair.hunterHandle ? byHandle[pair.hunterHandle] : null}
                    constellation={
                      pair.constellationHandle ? byHandle[pair.constellationHandle] : null
                    }
                    onOpen={openPost}
                  />
                ))}
              </div>
            )
          ) : listed.length === 0 ? (
            <p className="hint">
              {profiles.length === 0
                ? '아직 등록된 캐릭터가 없습니다.'
                : '검색 조건에 맞는 캐릭터가 없습니다.'}
            </p>
          ) : (
            <ul className="board-list">
              {listed.map((profile, index) => {
                const classDef = findClass(profile.side, profile.classId);
                const bond = bonds[profile.accountId];
                const partner = (bond?.partnerName ?? '').trim() || profile.partnerName.trim();
                const hunter = profile.side === 'HUNTER';
                return (
                  <li key={profile.accountId}>
                    <button
                      type="button"
                      className={`board-row ${hunter ? 'hunter' : 'constellation'}`}
                      onClick={() => openPost(profile.accountId)}
                    >
                      <span className="board-no">{String(index + 1).padStart(2, '0')}</span>
                      <Portrait src={profile.portrait} name={profile.name} size="sm" />
                      <span className="board-main">
                        <span className="board-title">
                          <b>{profile.name || '(이름 없음)'}</b>
                          <span className={`tag ${sideTag(profile.side)}`}>
                            {sideLabel(profile.side)}
                          </span>
                          <span className={`tag ${affiliationTag(profile.affiliation)}`}>
                            {affiliationLabel(profile.affiliation)}
                          </span>
                          {bond && <span className="tag ok">{bond.label}</span>}
                        </span>
                        <span className="board-meta">
                          <span>
                            {classDef ? `${classDef.labelKo} · ${classDef.label}` : '클래스 미지정'}
                          </span>
                          <span className={partner ? '' : 'dim'}>계약 상대 {partner || '미정'}</span>
                          {profile.pairName.trim() && <span>페어 {profile.pairName.trim()}</span>}
                        </span>
                      </span>
                      <span className="board-handle dim">@{profile.accountId}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <footer className="console-foot">
        <span>HUNTER MANAGEMENT AGENCY · PUBLIC ROSTER</span>
        <a href={homeUrl()}>← 세계관 소개 페이지</a>
      </footer>
    </div>
  );
}
