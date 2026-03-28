# CLAUDE.md — WKBL 해설 브리핑 자동화 프로젝트

> **Claude Code에게**: 이 파일을 읽고 아래 명세대로 프로젝트 전체를 처음부터 구축하라.
> 질문 없이 명세를 따르되, 기술적 판단이 필요한 부분은 최선의 방법으로 구현하라.

---

## 🎯 프로젝트 목적

**한국 여자농구리그(WKBL)** 해설 위원이 경기 해설을 준비할 수 있도록,
WKBL 공식 사이트에서 데이터를 자동 수집해 **GitHub Pages 웹 대시보드**로 제공한다.

- 매일 오전 09:00 KST (= 00:00 UTC) GitHub Actions로 자동 업데이트
- 두 팀을 선택하면 맞대결 브리핑 페이지를 즉시 표시
- 별도 서버 없이 GitHub Pages(정적 사이트)로 운영

---

## 📁 생성할 파일 구조

아래 구조를 **그대로** 생성하라. 폴더가 없으면 먼저 만들 것.

```
wkbl-briefing/                        ← 프로젝트 루트
├── CLAUDE.md                         ← 이 파일 (그대로 유지)
├── README.md                         ← 프로젝트 소개 문서
├── requirements.txt                  ← Python 의존성
├── .gitignore
├── .github/
│   └── workflows/
│       └── update.yml                ← GitHub Actions (매일 09:00 KST 자동 실행)
├── scripts/
│   └── scrape.py                     ← WKBL 데이터 수집 메인 스크립트
└── docs/                             ← GitHub Pages 루트 (Settings → Pages → /docs)
    ├── index.html                    ← 메인 대시보드
    ├── data/
    │   ├── meta.json                 ← 마지막 업데이트 시각
    │   ├── standings.json            ← 팀 순위
    │   ├── schedule.json             ← 경기 일정 (이번달 + 다음달)
    │   ├── player_records.json       ← 부문별 선수순위
    │   └── h2h/                      ← 맞대결 데이터 캐시
    │       └── .gitkeep
    └── assets/
        ├── style.css
        └── app.js
```

---

## 🔧 기술 스택

| 역할 | 기술 |
|------|------|
| 데이터 수집 | Python 3.11 + requests + BeautifulSoup4 |
| 자동화 | GitHub Actions (cron schedule) |
| 호스팅 | GitHub Pages (`docs/` 폴더 서빙) |
| 프론트엔드 | Vanilla HTML + CSS + JavaScript (프레임워크 없음) |
| 데이터 포맷 | JSON (docs/data/ 폴더) |

---

## 📋 파일별 상세 명세

---

### 1. `requirements.txt`

```
requests>=2.31.0
beautifulsoup4>=4.12.0
lxml>=4.9.0
```

---

### 2. `.gitignore`

```
__pycache__/
*.pyc
*.pyo
.env
.venv/
venv/
*.log
.DS_Store
Thumbs.db
```

---

### 3. `scripts/scrape.py`

**역할**: WKBL 공식 사이트에서 데이터를 수집해 `docs/data/` 하위 JSON 파일로 저장한다.

#### 3-1. WKBL 사이트 정보 (반드시 준수)

```python
BASE_URL    = "https://www.wkbl.or.kr"
SEASON_CODE = "046"   # 2025-2026 시즌. 다음 시즌은 "047"로 변경 필요.

# 팀 코드 (WKBL 사이트 기준)
TEAM_CODES = {
    "삼성생명": "03",
    "신한은행": "07",
    "우리은행": "05",
    "하나은행": "09",
    "BNK 썸":   "11",
    "KB스타즈":  "01",
}

# HTTP 요청 시 반드시 아래 헤더 사용 (없으면 차단됨)
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    "Referer": "https://www.wkbl.or.kr/",
}
```

#### 3-2. 수집할 데이터 & URL

| 데이터 | URL | 방식 |
|--------|-----|------|
| 팀 순위 | `/game/team_rank.asp` | GET |
| 경기 일정 | `/game/sch/schedule1.asp` | POST (body: `season_gu0=046&game_type0=&game_no0=&ym=YYYYMM`) |
| 선수 기록(득점) | `/game/player_record.asp` | GET |
| 팀 종합기록 | `/game/team_total_record.asp` | GET |
| 경기 결과 | `/game/result.asp?season_gu=046&gun=1&game_type=01&game_no={N}&ym={YYYYMM}&viewType=1` | GET |

#### 3-3. 파싱 규칙

**팀 순위 테이블 (`team_rank.asp`)**
- HTML `<table>` 첫 번째 테이블 파싱
- `<th>` → headers 배열: `["순위","팀명","경기수","성적","승률","승차","홈","원정","중립","LAST5","연속"]`
- `<tbody><tr>` → rows 배열 (각 행은 문자열 배열)
- 결과: `docs/data/standings.json`
  ```json
  {
    "updated": "2026-03-28T09:00:00+09:00",
    "headers": ["순위","팀명","경기수","성적","승률","승차","홈","원정","중립","LAST5","연속"],
    "rows": [
      ["1","KB스타즈","29","20승 9패","69.0","0","9-6","11-3","0-0","4-1","W1"],
      ...
    ]
  }
  ```

**경기 일정 (`schedule1.asp` POST)**
- 이번 달(현재 월) + 다음 달 2개월치 수집
- 지난 달도 포함해 최근 맞대결 기록 추출
- 테이블의 각 행에서: 날짜(M/D 패턴), img alt 팀명×2, 장소, 방송, game_no(경기기록 링크에서 추출)
- 결과: `docs/data/schedule.json`
  ```json
  {
    "updated": "2026-03-28T09:00:00+09:00",
    "games": [
      {
        "date": "2026-03-28",
        "home_team": "하나은행",
        "away_team": "BNK 썸",
        "venue": "부천체육관",
        "time": "14:00",
        "broadcast": "SPOTV Plus",
        "game_no": "85",
        "ym": "202603",
        "is_completed": false
      }
    ]
  }
  ```
- `game_no`가 존재하면 `is_completed: true`, 없으면 `false`

**선수 기록 (`player_record.asp`)**
- 첫 번째 테이블 파싱 (초기 로드 = 득점 순위)
- 결과: `docs/data/player_records.json`
  ```json
  {
    "updated": "2026-03-28T09:00:00+09:00",
    "득점": {
      "headers": ["순위","선수","소속구단","출전경기","3점슛","2점슛","자유투","총득점","평균득점"],
      "rows": [["1","김단비","우리은행","28","31","166","81","506","18.07"], ...]
    }
  }
  ```

**맞대결 데이터 (경기 결과 페이지)**
- 일정에서 `is_completed: true`인 경기 중 두 팀이 다른 팀인 경기들을 순회
- 각 경기에서 `양팀비교` 테이블 추출:
  - 테이블 헤더: 팀명 두 개
  - 행 구조: `[왼쪽값, 항목명, 오른쪽값]` 형태
  - 항목: `올시즌성적`, `올시즌 상대전적`, `최근 5경기`, `통산상대전적`
- MVP: `>선수명` 패턴 텍스트에서 추출
- 맞대결 조합마다 `docs/data/h2h/{팀A}_vs_{팀B}.json` 저장
  - 팀명 정렬: 두 팀을 가나다순으로 정렬 후 파일명 결정 (항상 일관성 유지)
  ```json
  {
    "updated": "2026-03-28T09:00:00+09:00",
    "team_a": "KB스타즈",
    "team_b": "삼성생명",
    "season_h2h": {"KB스타즈": "5승 1패", "삼성생명": "1승 5패"},
    "all_time_h2h": {"KB스타즈": "87승 99패", "삼성생명": "99승 87패"},
    "games": [
      {
        "date": "2026-03-27",
        "venue": "청주체육관",
        "result": {"KB스타즈": "시즌성적표시", "삼성생명": "시즌성적표시"},
        "mvp": "허예은 (KB스타즈)",
        "game_no": "84"
      }
    ]
  }
  ```

**메타 파일 (`docs/data/meta.json`)**
```json
{
  "last_updated": "2026-03-28T09:00:00+09:00",
  "season": "2025-2026",
  "season_code": "046"
}
```

#### 3-4. `scrape.py` 실행 흐름

```
main()
├── 1. create_session()           # 브라우저 세션 + wkbl 메인 방문으로 쿠키 초기화
├── 2. collect_standings()        # → docs/data/standings.json
├── 3. collect_schedule()         # → docs/data/schedule.json (지난달+이번달+다음달)
├── 4. collect_player_records()   # → docs/data/player_records.json
├── 5. collect_h2h_results()      # is_completed 경기 순회 → docs/data/h2h/*.json
├── 6. write_meta()               # → docs/data/meta.json
└── 7. print 완료 메시지
```

- 각 단계는 try/except로 감싸 실패해도 나머지가 진행되도록 할 것
- 수집 실패 시 `[WARN]` 로그 출력 후 빈 데이터로 파일 저장
- 모든 JSON 파일은 `ensure_ascii=False`, `indent=2`로 저장

---

### 4. `.github/workflows/update.yml`

GitHub Actions 워크플로우. **매일 오전 09:00 KST (= 00:00 UTC)** 자동 실행.

```yaml
name: WKBL 데이터 자동 업데이트

on:
  schedule:
    - cron: '0 0 * * *'    # 매일 00:00 UTC = 09:00 KST
  workflow_dispatch:         # 수동 실행 버튼도 제공

permissions:
  contents: write            # 파일 커밋 권한

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - name: 저장소 체크아웃
        uses: actions/checkout@v4

      - name: Python 3.11 설정
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: 의존성 설치
        run: pip install -r requirements.txt

      - name: WKBL 데이터 수집
        run: python scripts/scrape.py

      - name: 변경사항 커밋 & 푸시
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add docs/data/
          git diff --staged --quiet || git commit -m "chore: WKBL 데이터 자동 업데이트 $(date +'%Y-%m-%d %H:%M KST')"
          git push
```

---

### 5. `docs/index.html`

**GitHub Pages 메인 대시보드.**

#### UI 구성 (순서대로 배치)

```
┌─────────────────────────────────────────────┐
│  🏀 WKBL 해설 브리핑 대시보드              │
│  마지막 업데이트: 2026-03-28 09:00 KST     │
├─────────────────────────────────────────────┤
│  [ 팀 선택 섹션 ]                           │
│  홈팀: [드롭다운 ▼]  VS  원정팀: [드롭다운 ▼] │
│              [브리핑 보기 버튼]             │
├─────────────────────────────────────────────┤
│  [ 리그 순위 테이블 ]                       │
│  순위│팀명│경기수│성적│승률│LAST5│연속      │
├─────────────────────────────────────────────┤
│  [ 브리핑 패널 ] ← 팀 선택 후 표시         │
│  ┌──────────────────────────────────────┐   │
│  │  팀A    VS    팀B                    │   │
│  │  상대전적 / 최근5경기 / 통산전적      │   │
│  ├──────────────────────────────────────┤   │
│  │  이번 시즌 맞대결 기록 테이블         │   │
│  ├──────────────────────────────────────┤   │
│  │  팀A 매치업 스탯   팀B 매치업 스탯   │   │
│  ├──────────────────────────────────────┤   │
│  │  선수 득점 순위 (두 팀 하이라이트)   │   │
│  └──────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│  [ 이번달 + 다음달 경기 일정 ]              │
└─────────────────────────────────────────────┘
```

#### 디자인 요구사항

- **다크 테마**: 배경 `#0a0a0f`, 카드 `#13131a`, 텍스트 `#e8e8f0`
- **팀 컬러**:
  - KB스타즈: `#1E3A8A`
  - 하나은행: `#00704A`
  - 삼성생명: `#C8102E`
  - BNK 썸: `#E85D04`
  - 우리은행: `#004EA2`
  - 신한은행: `#E8192C`
- **폰트**: `'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif`
- 선택된 팀은 해당 팀 컬러로 강조 표시
- 반응형: 모바일(768px 이하)에서도 사용 가능
- 외부 라이브러리 없음 (순수 HTML/CSS/JS)

#### JavaScript 동작

```javascript
// 앱 초기화 순서
async function init() {
  await loadMeta()          // docs/data/meta.json → 업데이트 시각 표시
  await loadStandings()     // docs/data/standings.json → 팀순위 테이블 렌더
  await loadSchedule()      // docs/data/schedule.json → 일정 렌더 + 팀 드롭다운 목록 생성
  await loadPlayerRecords() // docs/data/player_records.json → 메모리에 캐시
}

// 팀 선택 → 브리핑 로드
async function showBriefing(teamA, teamB) {
  // 1. 가나다순 정렬로 파일명 결정
  const [t1, t2] = [teamA, teamB].sort()
  const filename = `${t1}_vs_${t2}.json`

  // 2. docs/data/h2h/{filename} fetch
  const h2h = await fetch(`data/h2h/${filename}`).then(r => r.json())

  // 3. 브리핑 패널 렌더
  renderBriefingPanel(teamA, teamB, h2h)
}

// 드롭다운: standings.json의 팀명으로 동적 생성
// 같은 팀 선택 불가 (같은 팀이면 버튼 비활성화)
// URL 해시로 선택 상태 저장: #우리은행-vs-신한은행
// 페이지 로드 시 URL 해시 있으면 자동으로 브리핑 표시
```

#### 데이터 fetch 경로

모든 데이터는 상대 경로로 fetch:
- `fetch('data/meta.json')`
- `fetch('data/standings.json')`
- `fetch('data/schedule.json')`
- `fetch('data/player_records.json')`
- `fetch('data/h2h/KB스타즈_vs_삼성생명.json')`

---

### 6. `docs/assets/style.css`

`index.html`에서 분리된 스타일시트. 아래 CSS 변수 반드시 포함:

```css
:root {
  --bg: #0a0a0f;
  --surf: #13131a;
  --surf2: #1c1c26;
  --border: #2a2a3a;
  --text: #e8e8f0;
  --muted: #666680;
  --accent: #f0b429;

  --team-kb: #1E3A8A;
  --team-hana: #00704A;
  --team-samsung: #C8102E;
  --team-bnk: #E85D04;
  --team-woori: #004EA2;
  --team-shinhan: #E8192C;
}
```

---

### 7. `docs/assets/app.js`

`index.html`에서 분리된 JavaScript. 아래 기능 포함:

```javascript
// 팀 컬러 매핑
const TEAM_COLORS = {
  "KB스타즈":  "#1E3A8A",
  "하나은행":  "#00704A",
  "삼성생명":  "#C8102E",
  "BNK 썸":   "#E85D04",
  "우리은행":  "#004EA2",
  "신한은행":  "#E8192C",
}

// 주요 함수 목록 (구현 필요)
// - init()
// - loadMeta()
// - loadStandings()
// - loadSchedule()
// - loadPlayerRecords()
// - showBriefing(teamA, teamB)
// - renderStandingsTable(data)
// - renderScheduleTable(data)
// - renderBriefingPanel(teamA, teamB, h2hData)
// - renderPlayerTable(data, teamA, teamB)
// - highlightTeamRows(tableEl, teamA, teamB)
// - getTeamColor(teamName)
// - formatLast5Badges(last5str)  // "4-1" → W/L 뱃지 HTML
// - handleHashChange()            // URL 해시 기반 라우팅
```

---

### 8. `README.md`

아래 내용을 포함:
- 프로젝트 설명 (WKBL 해설 브리핑 자동화)
- GitHub Pages URL 표시 위치 안내
- GitHub Actions 자동 업데이트 설명 (매일 09:00 KST)
- 로컬 개발 방법 (`python scripts/scrape.py` 로 로컬 실행)
- GitHub Pages 설정 방법 (`Settings → Pages → Source: /docs`)
- 시즌 코드 업데이트 방법 (`SEASON_CODE = "046"` → `"047"`)
- 데이터 출처: wkbl.or.kr

---

## ⚙️ 구현 순서 (Claude Code가 따를 것)

1. **폴더 구조 생성**: 모든 디렉토리 및 빈 파일 생성
2. **`requirements.txt`** 작성
3. **`.gitignore`** 작성
4. **`scripts/scrape.py`** 작성 (위 명세 전체 구현)
5. **`.github/workflows/update.yml`** 작성
6. **`docs/assets/style.css`** 작성
7. **`docs/assets/app.js`** 작성
8. **`docs/index.html`** 작성 (style.css, app.js 외부 파일로 연결)
9. **`README.md`** 작성
10. **로컬 테스트**: `python scripts/scrape.py` 실행 → `docs/data/` 파일들 생성 확인
11. **`docs/data/.gitkeep`** 및 **`docs/data/h2h/.gitkeep`** 생성 (빈 폴더 커밋용)

---

## ✅ 완료 기준 (Done Definition)

- [ ] `python scripts/scrape.py` 실행 시 에러 없이 `docs/data/*.json` 생성됨
- [ ] `docs/index.html`을 브라우저에서 열면 팀순위 테이블이 보임
- [ ] 팀 두 개 선택 → 브리핑 패널이 정상 표시됨
- [ ] `.github/workflows/update.yml`이 올바른 cron 표현식을 가짐
- [ ] 모든 파일이 UTF-8 인코딩으로 저장됨

---

## 🚀 GitHub 배포 후 설정 안내 (README에도 포함할 것)

```
1. GitHub에 저장소 push
2. GitHub 저장소 → Settings → Pages
3. Source: Deploy from a branch
4. Branch: main / Folder: /docs
5. Save → 몇 분 후 https://{username}.github.io/wkbl-briefing/ 접속 가능
6. Actions 탭에서 "WKBL 데이터 자동 업데이트" 워크플로우 수동 실행으로 첫 데이터 수집
```

---

## 📌 주의사항

- `docs/data/` 폴더의 JSON 파일들은 GitHub Actions가 자동으로 업데이트하므로 직접 수정하지 말 것
- WKBL 사이트 구조 변경 시 `scripts/scrape.py`의 파싱 로직만 수정하면 됨
- 새 시즌 시작 시 `scrape.py`의 `SEASON_CODE`를 `"047"`로 업데이트
- GitHub Actions 무료 플랜: 월 2,000분 제공 (이 프로젝트는 월 ~50분 사용 예상)