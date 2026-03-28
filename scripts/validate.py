"""
WKBL 데이터 검수 스크립트
scrape.py 실행 후 docs/data/ 의 JSON 파일들이 유효한지 검사한다.

검사 항목:
  - JSON 파일이 존재하고 파싱 가능한지
  - 필수 필드가 있는지
  - 데이터 건수가 최소 기준 이상인지
  - 팀명이 알려진 6개 팀 목록에 속하는지
  - 날짜 형식이 올바른지

종료 코드:
  0 = 모든 검사 통과
  1 = 경고(WARN) 있음 (커밋은 허용)
  2 = 오류(ERROR) 있음 (커밋 차단 권장)
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "docs" / "data"
H2H_DIR  = DATA_DIR / "h2h"

KNOWN_TEAMS = {"삼성생명", "신한은행", "우리은행", "하나은행", "BNK 썸", "KB스타즈"}

# 팀 약칭 prefix (순위표에서 "삼성생명 블루밍스" 처럼 부제가 붙는 경우 포함)
TEAM_PREFIXES = list(KNOWN_TEAMS)


def is_known_team(name: str) -> bool:
    return any(name.startswith(p) or p in name for p in TEAM_PREFIXES)

errors:   list[str] = []
warnings: list[str] = []


# ─── 헬퍼 ─────────────────────────────────────────────────────────────────────
def err(msg: str):
    errors.append(msg)
    print(f"  [ERROR] {msg}")


def warn(msg: str):
    warnings.append(msg)
    print(f"  [WARN]  {msg}")


def ok(msg: str):
    print(f"  [OK]    {msg}")


def load_json(path: Path) -> Optional[Dict]:
    if not path.exists():
        err(f"파일 없음: {path.relative_to(ROOT_DIR)}")
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        err(f"JSON 파싱 실패 ({path.name}): {e}")
        return None


def check_updated_field(data: dict, filename: str):
    val = data.get("updated") or data.get("last_updated")
    if not val:
        warn(f"{filename}: 'updated' 필드 없음")
        return
    try:
        datetime.fromisoformat(val.replace("+09:00", "+09:00"))
        ok(f"{filename}: updated = {val}")
    except ValueError:
        warn(f"{filename}: updated 날짜 형식 오류 ({val})")


def check_date_format(date_str: str, context: str):
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        warn(f"{context}: 날짜 형식 오류 ({date_str})")


# ─── 개별 파일 검사 ────────────────────────────────────────────────────────────
def check_meta():
    print("\n▶ meta.json 검사")
    data = load_json(DATA_DIR / "meta.json")
    if data is None:
        return
    for field in ("last_updated", "season", "season_code"):
        if not data.get(field):
            err(f"meta.json: '{field}' 필드 없음 또는 빈값")
        else:
            ok(f"meta.json: {field} = {data[field]}")


def check_standings():
    print("\n▶ standings.json 검사")
    data = load_json(DATA_DIR / "standings.json")
    if data is None:
        return
    check_updated_field(data, "standings.json")

    headers = data.get("headers", [])
    rows    = data.get("rows", [])

    if not headers:
        err("standings.json: headers 비어있음")
    else:
        ok(f"standings.json: headers = {headers[:3]}...")

    if len(rows) < 4:
        err(f"standings.json: 팀 수 부족 ({len(rows)}개, 최소 4팀 필요)")
    else:
        ok(f"standings.json: {len(rows)}팀 데이터")

    # 팀명 검증 (두 번째 컬럼)
    if headers and rows:
        team_idx = 1  # 팀명 컬럼 인덱스
        for row in rows:
            if len(row) > team_idx:
                team = row[team_idx]
                if team and not is_known_team(team):
                    warn(f"standings.json: 알 수 없는 팀명 '{team}'")


def check_schedule():
    print("\n▶ schedule.json 검사")
    data = load_json(DATA_DIR / "schedule.json")
    if data is None:
        return
    check_updated_field(data, "schedule.json")

    games = data.get("games", [])
    if len(games) < 1:
        warn("schedule.json: 경기 데이터 없음")
    else:
        ok(f"schedule.json: {len(games)}경기")

    completed = [g for g in games if g.get("is_completed")]
    upcoming  = [g for g in games if not g.get("is_completed")]
    ok(f"schedule.json: 완료 {len(completed)}경기 / 예정 {len(upcoming)}경기")

    for i, game in enumerate(games[:5]):  # 앞 5경기만 샘플 검사
        ctx = f"schedule.json[{i}]"
        for field in ("date", "home_team", "away_team"):
            if not game.get(field):
                warn(f"{ctx}: '{field}' 비어있음")
        if game.get("date"):
            check_date_format(game["date"], ctx)
        for team_field in ("home_team", "away_team"):
            team = game.get(team_field, "")
            if team and not is_known_team(team):
                warn(f"{ctx}: 알 수 없는 팀명 '{team}' ({team_field})")


def check_player_records():
    print("\n▶ player_records.json 검사")
    data = load_json(DATA_DIR / "player_records.json")
    if data is None:
        return
    check_updated_field(data, "player_records.json")

    scoring = data.get("득점", {})
    if not scoring:
        err("player_records.json: '득점' 섹션 없음")
        return

    headers = scoring.get("headers", [])
    rows    = scoring.get("rows", [])

    if not headers:
        err("player_records.json: 득점 headers 비어있음")
    else:
        ok(f"player_records.json: headers = {headers[:4]}...")

    if len(rows) < 5:
        warn(f"player_records.json: 득점 선수 수 부족 ({len(rows)}명, 최소 5명 예상)")
    else:
        ok(f"player_records.json: 득점 순위 {len(rows)}명")


def check_h2h():
    print("\n▶ h2h/*.json 검사")
    h2h_files = list(H2H_DIR.glob("*_vs_*.json"))

    if not h2h_files:
        warn("h2h/: 맞대결 파일 없음 (아직 완료된 경기가 없을 수 있음)")
        return

    ok(f"h2h/: {len(h2h_files)}개 맞대결 파일")

    error_count = 0
    for path in h2h_files:
        data = load_json(path)
        if data is None:
            error_count += 1
            continue

        fname = path.name
        for field in ("team_a", "team_b", "games"):
            if field not in data:
                err(f"h2h/{fname}: '{field}' 필드 없음")
                error_count += 1

        for team_field in ("team_a", "team_b"):
            team = data.get(team_field, "")
            if team and not is_known_team(team):
                warn(f"h2h/{fname}: 알 수 없는 팀명 '{team}'")

        # 파일명과 team_a/team_b 일치 여부
        stem = path.stem  # 예: KB스타즈_vs_삼성생명
        parts = stem.split("_vs_")
        if len(parts) == 2:
            expected_a, expected_b = sorted(parts)
            actual_a  = data.get("team_a", "")
            actual_b  = data.get("team_b", "")
            if sorted([actual_a, actual_b]) != sorted([expected_a, expected_b]):
                warn(f"h2h/{fname}: 파일명({stem})과 team_a/team_b({actual_a},{actual_b}) 불일치")

        games = data.get("games", [])
        for i, game in enumerate(games[:3]):
            ctx = f"h2h/{fname}[{i}]"
            if game.get("date"):
                check_date_format(game["date"], ctx)

    if error_count == 0:
        ok(f"h2h/: 모든 맞대결 파일 정상")


def check_file_encoding():
    """주요 JSON 파일이 UTF-8로 읽히는지 확인"""
    print("\n▶ UTF-8 인코딩 확인")
    files = list(DATA_DIR.glob("*.json")) + list(H2H_DIR.glob("*.json"))
    for path in files:
        try:
            with open(path, encoding="utf-8") as f:
                f.read()
        except UnicodeDecodeError as e:
            err(f"UTF-8 인코딩 오류 ({path.name}): {e}")
    if not errors:
        ok(f"{len(files)}개 파일 UTF-8 정상")


# ─── main ─────────────────────────────────────────────────────────────────────
def main():
    print("=" * 55)
    print("WKBL 데이터 검수 시작")
    print("=" * 55)

    check_meta()
    check_standings()
    check_schedule()
    check_player_records()
    check_h2h()
    check_file_encoding()

    print("\n" + "=" * 55)
    print(f"검수 완료: 오류 {len(errors)}건 / 경고 {len(warnings)}건")
    print("=" * 55)

    if errors:
        print("\n[오류 목록]")
        for e in errors:
            print(f"  ✗ {e}")
        print("\n→ 오류가 있어 데이터 커밋을 중단합니다.")
        sys.exit(2)

    if warnings:
        print("\n[경고 목록]")
        for w in warnings:
            print(f"  △ {w}")
        print("\n→ 경고가 있지만 커밋을 진행합니다.")
        sys.exit(1)

    print("\n→ 모든 검수 통과. 커밋을 진행합니다.")
    sys.exit(0)


if __name__ == "__main__":
    main()
