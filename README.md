# 마늘쫑 뽑기

설치 없이 실행되는 실력 기반 브라우저 아케이드 게임입니다.

## 실행

`index.html`을 브라우저에서 열거나, 이 폴더에서 정적 파일 서버를 실행한 뒤 접속하세요.

```bash
python3 -m http.server 8080
```

브라우저에서 `http://localhost:8080`을 열면 됩니다.

## 조작

- 마우스/터치: 마늘쫑을 누른 채 위로 당겨 힘 조절, 좌우로 움직여 각도 조절, 준비됐을 때 손을 놓아 수확
- 키보드: `Space`를 누른 채 `↑/↓`로 힘 조절, `←/→`로 각도 조절, 준비됐을 때 `Space`를 놓아 수확
- 위험 게이지가 오르면 힘을 잠시 빼서 회복

기록은 단순 점수가 아니라 누적 수확 길이 `cm`로 표시됩니다. 목숨은 전체 5개, 만렙은 밭 5개입니다. 한 밭에는 마늘쫑 4줄기가 있고, 현재 뽑을 줄기가 가운데로 옵니다.

첫 밭의 첫 3줄기는 자연스러운 튜토리얼입니다. 첫 줄기는 거의 무조건 성공해 손맛을 먼저 보여주고, 두 번째는 힘 조절, 세 번째는 흔들리는 저항 대응을 짧은 문구와 게이지 강조로 익히게 합니다.

플레이 중에는 장력선과 짧은 신호 문구가 현재 문제를 알려주고, 실패 후에는 다음 시도에서 고칠 점을 보여줍니다. 결과 화면은 `cm`뿐 아니라 숙련도, 최대 콤보, 완벽 수확, 다음 목표를 함께 보여줘 반복 도전의 기준을 만듭니다.

## 월드 랭킹 연결

Supabase Dashboard의 SQL Editor에서 `supabase-schema.sql`을 한 번 실행하세요.

그 다음 `supabase-config.js`에 아래 값을 넣으면 GitHub Pages에서도 월드 랭킹이 동작합니다.

- `url`: Supabase Project URL
- `anonKey`: Supabase `anon public` key

GitHub Pages 배포판은 저장소 Settings > Secrets and variables > Actions에 `SUPABASE_URL`, `SUPABASE_ANON_KEY`를 추가하면 배포 시 `supabase-config.js`가 자동으로 생성됩니다.

`service_role` 키는 절대 브라우저 코드에 넣지 마세요. 랭킹 테이블은 RLS로 공개 읽기와 점수 제출만 허용합니다.

## 점검

핵심 성공·실패·cm 기록·콤보·랭킹 저장 로직은 아래 명령으로 빠르게 확인할 수 있습니다.

```bash
node tests/smoke.js
```
