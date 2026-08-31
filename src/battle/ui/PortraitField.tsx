/**
 * 캐릭터 사진.
 *
 * 서버에 파일 저장소를 두지 않고 시트 안에 data URL 로 넣는다.
 * 그래서 **올린 그대로 저장하지 않는다** — 브라우저에서 정사각으로 잘라
 * PORTRAIT_RULES 크기까지 줄이고 JPEG 으로 다시 굽는다.
 * 원본이 몇 MB 든 저장되는 것은 수십 KB 다.
 */

import { useRef, useState } from 'react';

import { PORTRAIT_RULES } from '../config/rules';

/** 파일 하나를 정사각 축소본 data URL 로 만든다 */
export async function readPortrait(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('이미지 파일만 올릴 수 있습니다.');
  }
  if (file.size > PORTRAIT_RULES.maxUploadBytes) {
    throw new Error(
      `사진이 너무 큽니다 (최대 ${Math.round(PORTRAIT_RULES.maxUploadBytes / 1024 / 1024)}MB).`,
    );
  }

  const source = await loadImage(URL.createObjectURL(file));
  try {
    const side = PORTRAIT_RULES.side;
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('이 브라우저에서는 사진을 처리할 수 없습니다.');

    // 가운데를 정사각으로 잘라 넣는다 — 얼굴이 잘리는 쪽보다 여백이 생기는 쪽이 낫다
    const crop = Math.min(source.width, source.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      source,
      (source.width - crop) / 2,
      (source.height - crop) / 2,
      crop,
      crop,
      0,
      0,
      side,
      side,
    );

    // 품질을 한 단계씩 낮추며 목표 용량 안으로 들어올 때까지 다시 굽는다
    for (const quality of PORTRAIT_RULES.qualitySteps) {
      const url = canvas.toDataURL('image/jpeg', quality);
      if (url.length <= PORTRAIT_RULES.maxStoredChars) return url;
    }
    throw new Error('사진을 충분히 줄이지 못했습니다. 다른 이미지를 써 주세요.');
  } finally {
    URL.revokeObjectURL(source.src);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('사진을 읽을 수 없습니다.'));
    image.src = url;
  });
}

/** 사진 미리보기 — 없으면 자리만 잡아 둔다 */
export function Portrait({
  src,
  name,
  size = 'sm',
}: {
  src: string | null | undefined;
  name: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  if (!src) {
    return (
      <span className={`portrait empty size-${size}`} aria-hidden="true">
        {name.slice(0, 1) || '?'}
      </span>
    );
  }
  return <img className={`portrait size-${size}`} src={src} alt={`${name} 사진`} />;
}

/** 사진 올리기 · 지우기 */
export default function PortraitField({
  value,
  name,
  onChange,
  label = '사진',
}: {
  value: string | null | undefined;
  name: string;
  onChange: (next: string | null) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      onChange(await readPortrait(file));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '사진을 올리지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="portrait-field">
      <span className="field-label">{label}</span>
      <div className="portrait-row">
        <Portrait src={value} name={name} size="lg" />
        <div className="btn-row">
          <button
            type="button"
            className="ctl small"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? '처리 중…' : value ? '사진 바꾸기' : '사진 올리기'}
          </button>
          {value && (
            <button type="button" className="ctl small" onClick={() => onChange(null)}>
              지우기
            </button>
          )}
          <input
            ref={input}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              void pick(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
      </div>
      {error ? (
        <p className="hint warn-text">{error}</p>
      ) : (
        <p className="hint">
          가운데를 정사각으로 잘라 {PORTRAIT_RULES.side}px 로 줄여 저장합니다. 없어도 등록할 수
          있습니다.
        </p>
      )}
    </div>
  );
}
