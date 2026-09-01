/**
 * 이 계정이 지금 어느 전투에 배치돼 있는지.
 *
 * 보급 상점과 도박장이 같은 판정을 쓴다 — 둘 다 전투 밖에서만 여는 창구다.
 * 끝난 전투는 세지 않는다 (정산이 끝나면 다시 열려야 한다).
 *
 * 최종 판정은 서버(`is_deployed`)가 한다. 여기서 보는 것은 버튼을 미리 잠그고
 * 어느 전투에 묶여 있는지 이름을 보여 주기 위한 것이다.
 */

import { getStorage } from '../store';
import type { BattleState } from '../types';

export async function findDeployment(accountId: string): Promise<BattleState | null> {
  const storage = getStorage();
  for (const summary of await storage.listBattles()) {
    if (summary.status === 'CLEARED' || summary.status === 'FAILED') continue;
    const candidate = await storage.loadBattle(summary.id);
    if (!candidate) continue;
    const mine = candidate.pairs.some(
      (pair) => pair.hunterAccountId === accountId || pair.constellationAccountId === accountId,
    );
    if (mine) return candidate;
  }
  return null;
}
