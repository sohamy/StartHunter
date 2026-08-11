/**
 * 채팅 — 참가자와 운영자가 같은 창을 본다.
 *
 * 채널은 전투 단위(전투 id)이고, 전투 밖에서는 'GLOBAL' 을 쓴다.
 * 서버 모드에서는 Realtime 으로 즉시 반영되고, 로컬 모드에서는 주기적으로 다시 읽는다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getStorage, getServerStorage } from '../store';
import type { ActorSide, ChatKind, ChatMessage } from '../types';

export interface ChatAuthor {
  id: string;
  name: string;
  role: 'PARTICIPANT' | 'OPERATOR';
  side: ActorSide | null;
}

const KIND_LABEL: Record<ChatKind, string> = {
  TALK: '대화',
  ACTION: '행동',
  OOC: '잡담',
};

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
  const [kind, setKind] = useState<ChatKind>('TALK');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const atBottom = useRef(true);

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
  }, [messages]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !author) return;

    setSending(true);
    try {
      await storage.postMessage({
        id: `MSG-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
        channel,
        authorId: author.id,
        authorName: author.name,
        role: author.role,
        side: author.side,
        kind,
        body,
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

      {error && <p className="notice error">{error}</p>}

      <ol
        className="chat-list"
        ref={listRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {messages.length === 0 && <li className="chat-empty dim">아직 대화가 없습니다.</li>}
        {messages.map((message) => (
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
              {message.kind !== 'TALK' && (
                <span className="chat-kind">[{KIND_LABEL[message.kind]}]</span>
              )}
              {message.body}
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
            {(['TALK', 'ACTION', 'OOC'] as ChatKind[]).map((value) => (
              <button
                key={value}
                type="button"
                className={`ctl small ${kind === value ? 'on' : ''}`}
                onClick={() => setKind(value)}
              >
                {KIND_LABEL[value]}
              </button>
            ))}
            <span className="hint">
              {author.role === 'OPERATOR' ? '관리국' : author.name} 으로 발언
            </span>
          </div>
          <div className="chat-send">
            <textarea
              className="ctl input"
              rows={2}
              value={draft}
              maxLength={2000}
              placeholder={
                kind === 'ACTION'
                  ? '행동 서술 — 예: 검을 뽑아 앞으로 나선다'
                  : kind === 'OOC'
                    ? '진행 외 잡담'
                    : '대사를 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)'
              }
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
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
