/**
 * 라운드 처리.
 *
 * 흐름은 요구사항서 4장을 따른다.
 *   행동 확정 → 버프/디버프 → 헌터·성좌 행동 → 페어 연계
 *   → 적 행동(패턴) → 피해·상태이상 정산 → 기믹·페이즈 → 지속시간·쿨타임
 *
 * 예전에는 이 전부가 한 파일 1,977줄이었다. 단계마다 파일을 나눴다 —
 * 부르는 쪽은 여전히 `engine/round` 하나만 보면 된다.
 *
 *   availability  무엇을 고를 수 있는가
 *   action        제출을 행동 정의로 굳힌다
 *   status        어떤 상태이상이 붙는가
 *   pair          페어 한 쌍의 예상 결과
 *   enemy-turn    적의 차례와 지속 효과
 *   preview       예상 결과를 모은다 (상태를 바꾸지 않는다)
 *   apply         예상 결과를 실제 상태로 굳힌다
 *   submit        제출과 조작 모드
 */

export { apCostOf, submittedItemId, actionAvailability, type Availability } from './availability';
export { previewRound } from './preview';
export { applyRound } from './apply';
export { dismissAlert, setControlMode, submitPairAction } from './submit';
export type { PatternDefinition } from '../../config/patterns';
