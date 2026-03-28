# WKBL 해설 브리핑 대시보드

한국 여자농구리그(WKBL) 해설 위원을 위한 경기 준비 대시보드.
WKBL 공식 사이트에서 데이터를 자동 수집해 GitHub Pages 정적 사이트로 제공합니다.

## 라이브 사이트

> GitHub Pages 설정 후 아래 URL로 접속:
> `https://{username}.github.io/wkbl-briefing/`

## 주요 기능

- **리그 순위** 실시간 표시
- **팀 선택 → 맞대결 브리핑** 즉시 생성 (상대전적 / 최근 경기 / 선수 득점 순위)
- **경기 일정** (이번달 + 다음달)
- 매일 **오전 09:00 KST** GitHub Actions 자동 업데이트

## GitHub Pages 설정

```
1. GitHub 저장소 → Settings → Pages
2. Source: Deploy from a branch
3. Branch: main / Folder: /docs
4. Save → 몇 분 후 접속 가능
5. Actions 탭 → "WKBL 데이터 자동 업데이트" → Run workflow (첫 데이터 수집)
```

## 로컬 개발

```bash
# 의존성 설치
pip install -r requirements.txt

# 데이터 수집
python scripts/scrape.py

# 데이터 검수
python scripts/validate.py

# 브라우저에서 열기
open docs/index.html
```

## 데이터 검수

`scripts/validate.py`는 수집된 JSON 파일의 유효성을 검사합니다.

| 종료 코드 | 의미 |
|-----------|------|
| `0` | 모든 검수 통과 → 커밋 진행 |
| `1` | 경고 있음 → 커밋 진행 (검토 권장) |
| `2` | 오류 있음 → 커밋 **차단** |

GitHub Actions에서는 오류(exit 2) 발생 시 자동으로 커밋을 중단합니다.

## 시즌 코드 업데이트

새 시즌 시작 시 `scripts/scrape.py` 상단의 `SEASON_CODE`를 변경:

```python
SEASON_CODE = "046"  # 2025-2026 시즌
# 다음 시즌: "047"
```

## 파일 구조

```
wkbl-briefing/
├── scripts/
│   ├── scrape.py        ← 데이터 수집
│   └── validate.py      ← 데이터 검수
├── docs/                ← GitHub Pages 루트
│   ├── index.html
│   ├── data/            ← 자동 생성 JSON (직접 수정 금지)
│   └── assets/
├── .github/workflows/
│   └── update.yml       ← 자동 업데이트 (매일 09:00 KST)
└── requirements.txt
```

## 데이터 출처

[wkbl.or.kr](https://www.wkbl.or.kr) — 한국여자농구연맹 공식 사이트
