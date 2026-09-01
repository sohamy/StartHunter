/**
 * 창구에 선 사람 — 보급 상점과 도박장이 함께 쓴다.
 *
 * 사진은 두지 않는다. 참가자 시트와 달리 운영진이 올리는 이미지가 아니므로,
 * 명패에 새긴 한 글자로 대신한다 — 어떤 배포 환경에서도 빠지지 않는다.
 *
 * 대사는 두 갈래로 들어온다.
 *   · `line` 을 직접 주면 그 말을 한다 (방금 무슨 일이 있었는지 아는 쪽이 정한다)
 *   · 없으면 `mood` 에 맞는 말 중에서 `seed` 로 하나를 고른다
 */

import { npcLine, type NpcDefinition, type NpcMood } from '../config/npc';

export default function NpcCard({
  npc,
  mood = 'IDLE',
  seed = 0,
  line,
}: {
  npc: NpcDefinition;
  mood?: NpcMood;
  /** 같은 값이면 같은 말이 나온다 — 다시 그릴 때마다 대사가 바뀌지 않게 한다 */
  seed?: number;
  /** 이 말을 하게 한다. 비우면 mood 에서 고른다 */
  line?: string | null;
}) {
  return (
    <div className={`npc npc-${mood.toLowerCase()}`}>
      <div className="npc-plate" aria-hidden="true">
        {npc.sigil}
      </div>
      <div className="npc-body">
        <div className="npc-head">
          <b className="npc-name">{npc.name}</b>
          <span className="npc-code">{npc.code}</span>
          <span className="npc-title">{npc.title}</span>
        </div>
        <p className="npc-line">{line ?? npcLine(npc, mood, seed)}</p>
      </div>
    </div>
  );
}
