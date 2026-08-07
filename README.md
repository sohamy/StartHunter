# Constellation × Hunter Community Site

Astro 기반 정적 소개 홈페이지입니다.

## 로컬 실행

```bash
npm install
npm run dev
```

## GitHub Pages 배포 전 수정

`astro.config.mjs`에서 아래 값을 본인의 GitHub 정보로 변경하세요.

```js
site: 'https://YOUR_GITHUB_ID.github.io',
base: '/YOUR_REPOSITORY_NAME',
```

예: 저장소 주소가 `https://github.com/sohamy/StarTower`라면

```js
site: 'https://sohamy.github.io',
base: '/StarTower',
```

GitHub 저장소의 Settings → Pages → Source를 `GitHub Actions`로 설정하면 `.github/workflows/astro.yml`이 자동 배포합니다.
