/**
 * 대화록 — 채널의 글을 읽을 수 있는 한 편으로 엮는다.
 *
 * 로그 보존이 커뮤니티 RP 의 결과물인데, 지금까지는 최근 몇 줄을 화면에서 읽고 끝이었다.
 * 채널이 닫히거나 전투가 끝나면 그날 쓴 글을 되찾을 방법이 없었다.
 *
 * **JSON 이 아니라 글로 뽑는다.** 이 파일을 받아 갈 사람은 개발자가 아니라 그 글을 쓴
 * 사람이고, 커뮤니티에 다시 붙이거나 보관하려는 것이다. 다시 불러들일 일이 없으므로
 * 기계가 읽을 형식일 이유가 없다.
 *
 * 순수 함수로 둔다 — 브라우저도 React 도 모른다.
 */

import type { ChatMessage } from '../types';

/** 「09-02 03:12」 — 날짜와 시각. 연도는 파일 머리에 한 번만 적는다 */
function stamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '??-?? ??:??';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/** 누가 썼는가 — 운영진은 쪽이 없다 */
function who(message: ChatMessage): string {
  const side =
    message.role === 'OPERATOR'
      ? '관리국'
      : message.side === 'HUNTER'
        ? '헌터'
        : message.side === 'CONSTELLATION'
          ? '성좌'
          : null;
  // 운영진은 표시 이름이 이미 「관리국」인 경우가 많다 — 같은 말을 두 번 적지 않는다
  if (!side || side === message.authorName) return message.authorName;
  return `${message.authorName} · ${side}`;
}

/** 굴림 한 줄 — 목표치가 있으면 성패까지 적는다 */
function diceLine(dice: NonNullable<ChatMessage['dice']>): string {
  const rolls = dice.rolls.join(', ');
  const modifier = dice.modifier === 0 ? '' : dice.modifier > 0 ? ` +${dice.modifier}` : ` ${dice.modifier}`;
  const goal =
    dice.dc === undefined
      ? ''
      : ` (목표 ${dice.dc} · ${dice.success ? '성공' : '실패'})`;
  const label = dice.label ? `${dice.label} — ` : '';
  return `${label}${dice.expression} → [${rolls}]${modifier} = ${dice.total}${goal}`;
}

function bodyOf(message: ChatMessage): string {
  if (message.kind === 'ROLL' && message.dice) {
    const rolled = diceLine(message.dice);
    // 굴림에 대사가 함께 붙는 경우가 있다
    return message.body.trim() ? `${rolled}\n${message.body.trim()}` : rolled;
  }
  const body = message.body.trim();
  if (message.kind === 'OOC') return `[잡담] ${body}`;
  if (message.kind === 'ACTION') return `* ${body}`;
  return body;
}

/**
 * 채널 하나를 대화록으로 엮는다.
 *
 * 들어온 순서를 그대로 쓴다 — 저장 계층이 이미 시각순으로 준다.
 */
export function buildTranscript(
  messages: ChatMessage[],
  options: { title: string; exportedAt?: Date } = { title: '채널' },
): string {
  const at = options.exportedAt ?? new Date();
  const head = [
    `# ${options.title}`,
    `# ${at.getFullYear()}년 · 내보낸 시각 ${stamp(at.toISOString())} · ${messages.length}줄`,
    '',
  ];

  if (messages.length === 0) {
    return [...head, '(남은 글이 없습니다)', ''].join('\n');
  }

  const lines: string[] = [];
  let lastDay = '';
  for (const message of messages) {
    /* 날이 바뀌면 줄을 하나 그어 준다 — 며칠에 걸친 판을 읽을 때 기준이 된다 */
    const day = stamp(message.at).slice(0, 5);
    if (day !== lastDay) {
      if (lastDay) lines.push('');
      lines.push(`──────── ${day} ────────`);
      lastDay = day;
    }
    lines.push('', `[${stamp(message.at)}] ${who(message)}`, bodyOf(message));
  }

  return [...head, ...lines, ''].join('\n');
}

/** 파일 이름 — 채널 이름을 파일에 쓸 수 있는 글자로 줄인다 */
export function transcriptFileName(title: string, at: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  const slug = title.trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 40);
  return `${slug || 'channel'}_${day}.txt`;
}
