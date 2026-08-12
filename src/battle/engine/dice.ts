/**
 * 다이스 판정.
 *
 * `2d6+3`, `d20`, `3d10-1` 형식을 해석한다.
 * 결과는 굴린 눈을 모두 남겨서 판정 근거를 확인할 수 있게 한다.
 *
 * 굴림은 참가자 브라우저에서 일어난다 — 커뮤니티 진행 도구로서 관례적인 방식이며,
 * 결과가 채팅에 공개되고 관리국이 최종 판정을 하므로 조작의 이득이 크지 않다.
 */

export const DICE_LIMITS = {
  maxCount: 20,
  minSides: 2,
  maxSides: 100,
  maxModifier: 100,
} as const;

export interface DiceResult {
  /** 정규화된 표기 — 예: 2d6+3 */
  expression: string;
  count: number;
  sides: number;
  modifier: number;
  rolls: number[];
  total: number;
}

const PATTERN = /^\s*(\d*)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i;

export function parseDice(input: string): { count: number; sides: number; modifier: number } | null {
  const match = PATTERN.exec(input);
  if (!match) return null;

  const count = match[1] === '' ? 1 : Number(match[1]);
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[4]) * (match[3] === '-' ? -1 : 1) : 0;

  if (count < 1 || count > DICE_LIMITS.maxCount) return null;
  if (sides < DICE_LIMITS.minSides || sides > DICE_LIMITS.maxSides) return null;
  if (Math.abs(modifier) > DICE_LIMITS.maxModifier) return null;

  return { count, sides, modifier };
}

export function rollDice(input: string): DiceResult | null {
  const parsed = parseDice(input);
  if (!parsed) return null;

  const { count, sides, modifier } = parsed;
  const rolls: number[] = [];
  for (let index = 0; index < count; index += 1) {
    rolls.push(randomInt(sides));
  }

  const sum = rolls.reduce((total, value) => total + value, 0);
  const sign = modifier > 0 ? `+${modifier}` : modifier < 0 ? String(modifier) : '';

  return {
    expression: `${count}d${sides}${sign}`,
    count,
    sides,
    modifier,
    rolls,
    total: sum + modifier,
  };
}

/** 사람이 읽는 결과 문장 */
export function formatDice(result: DiceResult): string {
  const detail = result.rolls.join(', ');
  const sign =
    result.modifier > 0 ? ` + ${result.modifier}` : result.modifier < 0 ? ` − ${-result.modifier}` : '';
  return `${result.expression} → [${detail}]${sign} = ${result.total}`;
}

/** 최대치 / 최소치 판정 — 연출용 강조에 쓴다 */
export function diceExtreme(result: DiceResult): 'MAX' | 'MIN' | null {
  const max = result.count * result.sides;
  if (result.rolls.every((value) => value === result.sides) && result.count > 0) return 'MAX';
  if (result.rolls.every((value) => value === 1)) return 'MIN';
  void max;
  return null;
}

function randomInt(sides: number): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    // 나머지 편향을 제거하기 위해 상한을 넘는 값은 버린다
    const limit = Math.floor(0xffffffff / sides) * sides;
    const buffer = new Uint32Array(1);
    let value = 0;
    do {
      crypto.getRandomValues(buffer);
      value = buffer[0];
    } while (value >= limit);
    return (value % sides) + 1;
  }
  return Math.floor(Math.random() * sides) + 1;
}
