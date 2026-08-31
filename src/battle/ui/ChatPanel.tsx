/**
 * 채팅 — 참가자와 운영자가 같은 창을 본다.
 *
 * 채널은 전투 단위(전투 id)이고, 전투 밖에서는 'GLOBAL' 을 쓴다.
 * 서버 모드에서는 Realtime 으로 즉시 반영되고, 로컬 모드에서는 주기적으로 다시 읽는다.
 *
 * 진행(대사·행동)과 잡담은 **따로 본다**. 섞이면 진행을 놓친다.
 * 판정(다이스)은 어느 쪽에서 굴려도 양쪽에 보인다 — 결과는 모두가 알아야 하기 때문이다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { formatDice, rollDice } from '../engine/dice';
import { newUuid } from '../engine/id';
import { getStorage, getServerStorage } from '../store';
import type { ActorSide, ChatKind, ChatMessage } from '../types';

export interface ChatAuthor {
  id: string;
  name: string;
  role: 'PARTICIPANT' | 'OPERATOR';
  side: ActorSide | null;
}

const KIND_LABEL: Record<ChatKind, string> = {
  /** 대사와 행동은 한 글에 함께 쓴다 — 말머리를 나누지 않는다 */
  TALK: '대사 · 행동',
  /** 예전 글에만 남아 있는 말머리 */
  ACTION: '행동',
  OOC: '잡담',
  ROLL: '판정',
};

/**
 * 보기 · 쓰기 탭.
 * 진행(대사·행동)과 잡담을 나눠 두고, 판정은 양쪽에 함께 보인다.
 */
type View = 'PLAY' | 'OOC';

const VIEWS: Array<{ id: View; label: string; kind: ChatKind; hint: string }> = [
  {
    id: 'PLAY',
    label: '대사 · 행동',
    kind: 'TALK',
    hint: '대사와 행동을 함께 적으세요 — 예: "물러서." 검을 뽑아 앞으로 나선다',
  },
  { id: 'OOC', label: '잡담', kind: 'OOC', hint: '진행 외 잡담' },
];

/** 이 보기에 속하는 글인지. 판정은 어느 보기에서도 보인다. */
function inView(kind: ChatKind, view: View): boolean {
  if (kind === 'ROLL') return true;
  return view === 'OOC' ? kind === 'OOC' : kind === 'TALK' || kind === 'ACTION';
}

const ROLL_COMMAND = /^\/(?:roll|r)\s+(.+)$/i;

function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function ChatPanel({
  channel,
  author,
  title = 'CHANNEL',
}: {
  channel: string;
  author: ChatAuthor | null;
  title?: string;
}) {
  const storage = useMemo(() => getStorage(), []);
  const serverStorage = useMemo(() => getServerStorage(), []);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [view, setView] = useState<View>('PLAY');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const atBottom = useRef(true);
  /** 소프트 키보드에서는 Enter 가 줄바꿈이어야 한다 — 전송은 버튼이 맡는다 */
  const [softKeyboard, setSoftKeyboard] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(hover: none) and (pointer: coarse)');
    const apply = () => setSoftKeyboard(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  const load = useCallback(async () => {
    try {
      setMessages(await storage.listMessages(channel));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '채팅을 불러올 수 없습니다.');
    }
  }, [channel, storage]);

  useEffect(() => {
    void load();

    // 서버 모드는 Realtime, 로컬 모드는 폴링
    if (serverStorage) {
      return serverStorage.subscribeChat(channel, () => void load());
    }
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [channel, load, serverStorage]);

  // 새 글이 오면 아래로 붙인다 — 위를 읽고 있을 때는 건드리지 않는다
  useEffect(() => {
    if (atBottom.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, view]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !author) return;

    // /roll 2d6+3 또는 /r d20 → 판정 메시지
    const command = ROLL_COMMAND.exec(body);
    const rolled = command ? rollDice(command[1]) : null;
    if (command && !rolled) {
      setError('다이스 표기를 이해할 수 없습니다. 예: /roll 2d6+3, /r d20');
      return;
    }

    setSending(true);
    try {
      await storage.postMessage({
        id: newUuid(),
        channel,
        authorId: author.id,
        authorName: author.name,
        role: author.role,
        side: author.side,
        kind: rolled ? 'ROLL' : currentView.kind,
        body: rolled ? formatDice(rolled) : body,
        dice: rolled
          ? {
              expression: rolled.expression,
              rolls: rolled.rolls,
              modifier: rolled.modifier,
              total: rolled.total,
            }
          : null,
        at: new Date().toISOString(),
      });
      setDraft('');
      atBottom.current = true;
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '전송에 실패했습니다.');
    } finally {
      setSending(false);
    }
  };

  const currentView = VIEWS.find((row) => row.id === view) ?? VIEWS[0];
  const shown = messages.filter((message) => inView(message.kind, view));

  const remove = async (id: string) => {
    try {
      await storage.deleteMessage(id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '삭제에 실패했습니다.');
    }
  };

  return (
    <section className="panel chat">
      <div className="process-head">
        <h2 className="panel-title">{title}</h2>
        <span className="hint">
          {channel === 'GLOBAL' ? '전체 채널' : `전투 채널 · ${channel.slice(-6)}`} · 참가자와
          운영진이 함께 봅니다
        </span>
      </div>

      {/* 진행과 잡담은 따로 본다. 판정은 양쪽에 함께 보인다. */}
      <div className="btn-row chat-views">
        {VIEWS.map((row) => (
          <button
            key={row.id}
            type="button"
            className={`ctl small ${view === row.id ? 'on' : ''}`}
            onClick={() => {
              setView(row.id);
              atBottom.current = true;
            }}
          >
            {row.label} · {messages.filter((message) => inView(message.kind, row.id)).length}
          </button>
        ))}
        <span className="hint">판정(🎲)은 어느 쪽에서 굴려도 양쪽에 보입니다.</span>
      </div>

      {error && <p className="notice error">{error}</p>}

      <ol
        className="chat-list"
        ref={listRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {shown.length === 0 && (
          <li className="chat-empty dim">
            {view === 'OOC' ? '잡담이 없습니다.' : '아직 대화가 없습니다.'}
          </li>
        )}
        {shown.map((message) => (
          <li
            key={message.id}
            className={[
              'chat-line',
              `kind-${message.kind.toLowerCase()}`,
              message.role === 'OPERATOR' ? 'operator' : '',
              author && message.authorId === author.id ? 'mine' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className="chat-time num">{clock(message.at)}</span>
            <span className="chat-author">
              {message.role === 'OPERATOR' ? (
                <span className="tag critical">관리국</span>
              ) : (
                message.side && (
                  <span className={`tag ${message.side === 'HUNTER' ? 'blue' : 'gold'}`}>
                    {message.side === 'HUNTER' ? '헌터' : '성좌'}
                  </span>
                )
              )}
              <b>{message.authorName}</b>
            </span>
            <span className="chat-body">
              {message.kind === 'ROLL' && message.dice ? (
                <span className="dice-result">
                  <span className="dice-icon" aria-hidden="true">
                    🎲
                  </span>
                  <b className="dice-expr">{message.dice.expression}</b>
                  <span className="dice-rolls">[{message.dice.rolls.join(', ')}]</span>
                  {message.dice.modifier !== 0 && (
                    <span className="dice-mod">
                      {message.dice.modifier > 0 ? `+${message.dice.modifier}` : message.dice.modifier}
                    </span>
                  )}
                  <b className="dice-total">= {message.dice.total}</b>
                  {message.dice.dc !== undefined && (
                    <span className={`tag ${message.dice.success ? 'ok' : 'critical'}`}>
                      목표 {message.dice.dc} · {message.dice.success ? '성공' : '실패'}
                    </span>
                  )}
                  {message.dice.label && <span className="dim">{message.dice.label}</span>}
                </span>
              ) : (
                <>
                  {/* 보기가 나뉘어 있으므로 말머리는 옛 글(행동)에만 남긴다 */}
                  {message.kind === 'ACTION' && (
                    <span className="chat-kind">[{KIND_LABEL[message.kind]}]</span>
                  )}
                  {message.body}
                </>
              )}
            </span>
            {author && (message.authorId === author.id || author.role === 'OPERATOR') && (
              <button
                type="button"
                className="chat-del"
                title="삭제"
                onClick={() => void remove(message.id)}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ol>

      {author ? (
        <div className="chat-input">
          <div className="btn-row">
            <span className="hint">
              <b>{author.role === 'OPERATOR' ? '관리국' : author.name}</b> 으로{' '}
              {currentView.label} 에 씁니다 · 판정은 <b>/roll 2d6+3</b> ·{' '}
              {softKeyboard ? '전송 버튼으로 보냅니다' : 'Enter 전송 · Shift+Enter 줄바꿈'}
            </span>
          </div>
          <div className="chat-send">
            <textarea
              className="ctl input"
              rows={2}
              value={draft}
              maxLength={2000}
              placeholder={currentView.hint}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (softKeyboard) return;
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="button"
              className="ctl primary"
              disabled={sending || draft.trim().length === 0}
              onClick={() => void send()}
            >
              전송
            </button>
          </div>
        </div>
      ) : (
        <p className="hint">로그인하면 대화에 참여할 수 있습니다.</p>
      )}
    </section>
  );
}
