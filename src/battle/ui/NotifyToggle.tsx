/**
 * 브라우저 알림 켜기.
 *
 * **사람이 눌러야 물어본다.** 화면이 열릴 때 자동으로 권한을 물으면 대부분 반사적으로
 * 거절하고, 한 번 거절한 뒤에는 다시 물을 수 없다 — 브라우저가 막는다.
 *
 * 권한은 사이트 단위라 한 번 켜면 전투 단말 · 상점 · 도박장 모두에 적용된다.
 * 그래서 버튼은 기다리는 시간이 가장 긴 전투 단말에 하나만 둔다.
 *
 * 켜지 않아도 탭 제목의 뱃지(「(1) 전투 단말」)는 그대로 뜬다 — 권한이 필요 없는 쪽이다.
 */

import type { Notifier } from './useNotify';

export default function NotifyToggle({ notifier }: { notifier: Notifier }) {
  const { permission, ask } = notifier;

  if (permission === 'unsupported') return null;

  if (permission === 'granted') {
    return (
      <span className="tag ok" title="자리를 비운 사이에 내 차례가 오면 알려 줍니다">
        알림 켜짐
      </span>
    );
  }

  if (permission === 'denied') {
    return (
      <span className="tag offline" title="브라우저 주소창의 자물쇠에서 되돌릴 수 있습니다">
        알림 차단됨
      </span>
    );
  }

  return (
    <button
      type="button"
      className="ctl small"
      title="내 차례 · 라운드 처리 · 선물 도착을 알려 줍니다. 탭을 보고 있을 때는 알리지 않습니다."
      onClick={() => void ask()}
    >
      알림 켜기
    </button>
  );
}
