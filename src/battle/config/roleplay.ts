/**
 * 연출 로그 템플릿.
 *
 * 운영진이 커뮤니티 진행에 그대로 붙여 쓸 수 있는 텍스트를 만든다.
 * 문구를 바꾸려면 이 파일만 수정하면 된다. {중괄호} 는 치환된다.
 */

export const ROLEPLAY_TEMPLATES = {
  roundHeader: '─ ROUND {round} ─',
  telegraph: '{enemy}의 움직임이 멈춥니다.\n{message}',
  constellationBuff: '「{constellation}」의 권능이 {hunter}에게 내려앉습니다.',
  constellationDebuff: '「{constellation}」의 권능이 {enemy}의 균형을 무너뜨립니다.',
  constellationRevelation: '「{constellation}」이 {hunter}에게 계시를 보냅니다.',
  constellationManifest: '「{constellation}」의 형상이 전장에 반쯤 내려옵니다.',
  hunterAttack: '{hunter}이(가) {action}으로 파고듭니다.',
  hunterDefend: '{hunter}이(가) 자세를 낮추고 충격을 받아냅니다.',
  hunterRescue: '{hunter}이(가) 쓰러진 {target}을(를) 끌어냅니다.',
  hunterGimmick: '{hunter}이(가) 장치에 손을 뻗습니다.',
  combo: 'PAIR COMBINATION\n《 {combo} 》',
  damage: '{enemy}에게 {damage}의 피해!',
  hpLine: 'HP\n{before} → {after}',
  statusApplied: '{target}에게 {status}이(가) 남습니다.',
  enemyAttack: '{enemy}의 {pattern}이 {target}을(를) 덮칩니다. ({damage})',
  enemyAoe: '{enemy}의 {pattern}이 공략조 전체를 훑습니다.',
  dot: '{target}을(를) {status}이(가) 계속 태웁니다. ({damage})',
  hunterDown: '{target}이(가) 무릎을 꺾습니다. — 전투 불능',
  gimmickCleared: '{gimmick} 해제. {message}',
  gimmickFailed: '{gimmick} 해제 실패. {message}',
  phaseChange: '{enemy}의 기척이 바뀝니다. — {phase}',
} as const;

export type RoleplayTemplateKey = keyof typeof ROLEPLAY_TEMPLATES;

export function fill(key: RoleplayTemplateKey, values: Record<string, string | number>): string {
  return ROLEPLAY_TEMPLATES[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values[name] ?? `{${name}}`),
  );
}
