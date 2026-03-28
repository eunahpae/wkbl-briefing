"""
WKBL 데이터 수집 스크립트
wkbl.or.kr에서 팀순위, 경기일정, 선수기록, 맞대결 데이터를 수집해 docs/data/ 에 저장한다.

페이지 구조 메모:
- 팀순위: POST /game/ajax/ajax_team_rank.asp (season_gu, gun)
          → TR 목록만 반환 (table wrapper 없음), 팀명은 span.language[data-kr]
- 경기일정: POST /game/sch/schedule1.asp (season_gu0, game_type0, game_no0, ym)
           → 월 달력 HTML, 경기는 td > .info_game > span.language[data-kr]
- 선수기록: POST /game/ajax/ajax_player_record.asp (season_gu, part)
           → 완전한 table HTML 반환
- 맞대결:  POST /game/ajax/ajax_game_result_1.asp (season_gu, game_type, game_no, ym)
           → 양팀비교 table, 3열 구조 [왼쪽값, 항목명, 오른쪽값]
"""

import json
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

# ─── 상수 ───────────────────────────────────────────────────────────────────
BASE_URL    = "https://www.wkbl.or.kr"
SEASON_CODE = "046"   # 2025-2026 시즌. 다음 시즌은 "047"로 변경 필요.

TEAM_CODES = {
    "삼성생명": "03",
    "신한은행": "07",
    "우리은행": "05",
    "하나은행": "09",
    "BNK 썸":   "11",
    "KB스타즈":  "01",
}

# 팀명 유효성 검사용 (순위표에서 부제 포함 e.g. "삼성생명 블루밍스" 허용)
KNOWN_TEAM_PREFIXES = list(TEAM_CODES.keys())


def is_wkbl_team(name: str) -> bool:
    return any(name.startswith(p) or p in name for p in KNOWN_TEAM_PREFIXES)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    "Referer": "https://www.wkbl.or.kr/",
}

KST = ZoneInfo("Asia/Seoul")

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "docs" / "data"
H2H_DIR  = DATA_DIR / "h2h"


# ─── 유틸 ────────────────────────────────────────────────────────────────────
def now_kst() -> str:
    return datetime.now(tz=KST).strftime("%Y-%m-%dT%H:%M:%S+09:00")


def save_json(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"[OK] 저장: {path.relative_to(ROOT_DIR)}")


def get_kr_text(el) -> str:
    """span.language[data-kr] 우선, 없으면 일반 텍스트"""
    lang = el.find(class_="language")
    if lang and lang.get("data-kr"):
        return lang["data-kr"].strip()
    return el.get_text(separator=" ", strip=True)


def get_cell_text(td) -> str:
    """TD에서 data-kr 우선 텍스트 추출"""
    if td.get("data-kr"):
        return td["data-kr"].strip()
    lang = td.find(class_="language")
    if lang and lang.get("data-kr"):
        return lang["data-kr"].strip()
    return td.get_text(separator=" ", strip=True)


def ajax_post(session: requests.Session, url: str, data: dict) -> Optional[BeautifulSoup]:
    headers = {
        **HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
    }
    r = session.post(url, data=data, headers=headers, timeout=15)
    r.raise_for_status()
    r.encoding = r.apparent_encoding or "utf-8"
    return BeautifulSoup(r.text, "lxml")


# ─── 세션 초기화 ─────────────────────────────────────────────────────────────
def create_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)
    try:
        session.get(BASE_URL, timeout=15)
        time.sleep(0.5)
    except Exception as e:
        print(f"[WARN] 세션 초기화 실패: {e}")
    return session


# ─── 팀 순위 ─────────────────────────────────────────────────────────────────
def collect_standings(session: requests.Session) -> Optional[Dict]:
    out = DATA_DIR / "standings.json"
    fixed_headers = ["순위", "팀명", "경기수", "성적", "승률", "승차", "홈", "원정", "중립", "LAST5", "연속"]
    try:
        soup = ajax_post(session, f"{BASE_URL}/game/ajax/ajax_team_rank.asp",
                         {"season_gu": SEASON_CODE, "gun": "1"})

        rows = []
        for tr in soup.find_all("tr", class_="team_rnak_table"):
            tds = tr.find_all("td")
            if not tds:
                continue
            row = []
            for td in tds:
                row.append(get_cell_text(td))
            if len(row) >= 3:
                rows.append(row)

        if not rows:
            raise ValueError(f"파싱된 팀 순위 행이 없음 (TR 수: {len(soup.find_all('tr'))})")

        data = {"updated": now_kst(), "headers": fixed_headers, "rows": rows}
        save_json(out, data)
        print(f"  → {len(rows)}팀 데이터 수집")
        return data
    except Exception as e:
        print(f"[WARN] 팀 순위 수집 실패: {e}")
        save_json(out, {"updated": now_kst(), "headers": fixed_headers, "rows": []})
        return None


# ─── 경기 일정 ────────────────────────────────────────────────────────────────
def _parse_calendar_games(soup: BeautifulSoup, year: str, month: str, ym: str) -> List[Dict]:
    """달력 HTML에서 경기 목록 추출"""
    games = []
    table = soup.find("table")
    if not table:
        return games

    for td in table.find_all("td"):
        # 날짜 추출
        date_span = td.find(class_="date_day")
        if not date_span:
            continue
        day_text = date_span.get_text(strip=True)
        if not day_text.isdigit():
            continue
        day = day_text.zfill(2)
        # 존재하지 않는 날짜(2/29, 2/30 등) 필터링
        try:
            datetime(int(year), int(month), int(day))
        except ValueError:
            continue
        date_str = f"{year}-{month}-{day}"

        # 이 날짜의 경기들 (여러 경기 가능)
        for info_div in td.find_all(class_="info_game"):
            team_spans = info_div.find_all("span", class_="language")
            teams = [sp.get("data-kr", sp.get_text(strip=True)) for sp in team_spans
                     if sp.get("data-kr") or sp.get_text(strip=True)]
            teams = [t.strip() for t in teams if t.strip() and t.strip() != "vs"]
            if len(teams) < 2:
                continue
            home_team = teams[0]
            away_team = teams[1]

            # game_no + 점수: 경기결과 링크에서 추출
            game_no = ""
            home_score = ""
            away_score = ""
            link = info_div.find("a", class_="txt_info")
            if link and link.get("href"):
                m = re.search(r"game_no=(\d+)", link["href"])
                if m:
                    game_no = m.group(1)
                # [<em>77</em> vs <em>55</em>] 형태에서 점수 추출
                ems = link.find_all("em")
                if len(ems) >= 2:
                    home_score = ems[0].get_text(strip=True)
                    away_score = ems[1].get_text(strip=True)

            # WKBL 6팀 경기만 포함 (다른 리그 경기 필터링)
            if not is_wkbl_team(home_team) or not is_wkbl_team(away_team):
                continue

            games.append({
                "date": date_str,
                "home_team": home_team,
                "away_team": away_team,
                "home_score": home_score,
                "away_score": away_score,
                "venue": "",
                "time": "",
                "broadcast": "",
                "game_no": game_no,
                "ym": ym,
                "is_completed": bool(game_no),
            })

    return games


def _fetch_month_schedule(session: requests.Session, ym: str) -> List[Dict]:
    """GET 방식으로 전체 월 일정 수집
    (POST /schedule1.asp 는 최근 경기만 표시하므로,
     GET ?gun=1&season_gu=046&ym=YYYYMM&viewType=1 사용)
    """
    year, month = ym[:4], ym[4:6]
    url = (f"{BASE_URL}/game/sch/schedule1.asp"
           f"?gun=1&season_gu={SEASON_CODE}&ym={ym}&viewType=1")
    r = session.get(url, timeout=15)
    r.raise_for_status()
    r.encoding = r.apparent_encoding or "utf-8"
    soup = BeautifulSoup(r.text, "lxml")
    return _parse_calendar_games(soup, year, month, ym)


def collect_schedule(session: requests.Session) -> Optional[Dict]:
    out = DATA_DIR / "schedule.json"
    try:
        today = datetime.now(tz=KST)

        # 시즌 시작(2025-10)부터 다음달까지 전체 수집 (h2h 완전성 확보)
        season_start_ym = "202510"
        months = []
        cur = datetime(2025, 10, 1, tzinfo=KST)
        next_month_dt = (today.replace(day=1).replace(
            month=today.month % 12 + 1,
            year=today.year + (1 if today.month == 12 else 0)
        ))
        while cur <= next_month_dt:
            months.append(cur.strftime("%Y%m"))
            # 다음달로 이동
            m = cur.month + 1
            y = cur.year
            if m == 13:
                m, y = 1, y + 1
            cur = cur.replace(year=y, month=m, day=1)

        all_games = []
        for ym in months:
            try:
                games = _fetch_month_schedule(session, ym)
                all_games.extend(games)
                print(f"  → {ym}: {len(games)}경기")
                time.sleep(0.5)
            except Exception as e:
                print(f"[WARN] {ym} 일정 수집 실패: {e}")

        data = {"updated": now_kst(), "games": all_games}
        save_json(out, data)
        return data
    except Exception as e:
        print(f"[WARN] 경기 일정 수집 실패: {e}")
        save_json(out, {"updated": now_kst(), "games": []})
        return None


# ─── 선수 기록 ────────────────────────────────────────────────────────────────
def collect_player_records(session: requests.Session) -> Optional[Dict]:
    out = DATA_DIR / "player_records.json"
    try:
        soup = ajax_post(session, f"{BASE_URL}/game/ajax/ajax_player_record.asp",
                         {"season_gu": SEASON_CODE, "part": "point"})

        table = soup.find("table")
        if not table:
            raise ValueError("선수기록 테이블을 찾을 수 없음")

        # 헤더: thead tr.language[data-kr]에 th가 인라인으로 있음
        headers = []
        thead = table.find("thead")
        if thead:
            header_tr = thead.find("tr")
            if header_tr:
                # data-kr 속성에 전체 th HTML이 들어있는 경우
                data_kr = header_tr.get("data-kr", "")
                if data_kr:
                    th_soup = BeautifulSoup(data_kr, "lxml")
                    headers = [th.get_text(strip=True) for th in th_soup.find_all("th")]
                else:
                    headers = [get_cell_text(th) for th in header_tr.find_all("th")]

        rows = []
        tbody = table.find("tbody")
        if tbody:
            for tr in tbody.find_all("tr"):
                row = [get_cell_text(td) for td in tr.find_all("td")]
                if row:
                    rows.append(row)

        if not rows:
            raise ValueError(f"파싱된 선수 기록 행 없음")

        data = {
            "updated": now_kst(),
            "득점": {"headers": headers, "rows": rows},
        }
        save_json(out, data)
        print(f"  → 득점 순위 {len(rows)}명")
        return data
    except Exception as e:
        print(f"[WARN] 선수 기록 수집 실패: {e}")
        save_json(out, {"updated": now_kst(), "득점": {"headers": [], "rows": []}})
        return None


# ─── 맞대결 데이터 ────────────────────────────────────────────────────────────
def _parse_h2h_ajax(soup: BeautifulSoup, game_no: str) -> Optional[Dict]:
    """ajax_game_result_1.asp 응답에서 양팀비교 데이터 파싱"""
    tables = soup.find_all("table")
    h2h_table = None
    team_left = team_right = ""

    for table in tables:
        # 헤더 행에서 팀명 두 개 찾기
        header_row = table.find("tr")
        if not header_row:
            continue
        ths = header_row.find_all("th")
        if len(ths) >= 2:
            possible_left  = ths[0].get_text(strip=True)
            possible_right = ths[-1].get_text(strip=True)
            # 팀명이 포함된 헤더 확인
            for team in TEAM_CODES:
                if team in possible_left:
                    team_left = team
                if team in possible_right:
                    team_right = team
            if team_left and team_right:
                h2h_table = table
                break

    if not h2h_table or not team_left or not team_right:
        return None

    parsed = {"season_record": {}, "season_h2h": {}, "recent5": {}, "all_time_h2h": {}}
    tbody = h2h_table.find("tbody") or h2h_table
    for tr in tbody.find_all("tr"):
        tds = tr.find_all("td")
        th_cells = tr.find_all("th")
        # 구조: <td>왼쪽값</td><th>항목명</th><td>오른쪽값</td>
        if len(tds) == 2 and len(th_cells) >= 1:
            left_val  = tds[0].get_text(strip=True)
            label     = th_cells[0].get_text(strip=True)
            right_val = tds[1].get_text(strip=True)
        elif len(tds) >= 3:
            # 혹시 모두 TD인 경우 대비
            left_val  = tds[0].get_text(strip=True)
            label     = tds[1].get_text(strip=True)
            right_val = tds[2].get_text(strip=True)
        else:
            continue

        if "올시즌성적" in label:
            parsed["season_record"] = {team_left: left_val, team_right: right_val}
        elif "올시즌 상대전적" in label or "시즌상대전적" in label:
            parsed["season_h2h"]    = {team_left: left_val, team_right: right_val}
        elif "최근 5경기" in label or "최근5경기" in label:
            parsed["recent5"]       = {team_left: left_val, team_right: right_val}
        elif "통산상대전적" in label or "통산 상대전적" in label:
            parsed["all_time_h2h"]  = {team_left: left_val, team_right: right_val}

    return {
        "team_left":     team_left,
        "team_right":    team_right,
        "season_record": parsed["season_record"],
        "season_h2h":    parsed["season_h2h"],
        "recent5":       parsed["recent5"],
        "all_time_h2h":  parsed["all_time_h2h"],
    }


def collect_h2h_results(session: requests.Session, schedule_data: Optional[Dict]):
    if not schedule_data:
        print("[WARN] 일정 데이터 없음, 맞대결 수집 건너뜀")
        return

    completed = [g for g in schedule_data.get("games", [])
                 if g.get("is_completed") and g.get("game_no")]

    # 맞대결 조합별로 게임 목록 집계
    h2h_map: Dict[str, Dict] = {}
    for game in completed:
        home, away = game["home_team"], game["away_team"]
        if not home or not away or home == away:
            continue
        key = "_vs_".join(sorted([home, away]))
        if key not in h2h_map:
            ta, tb = sorted([home, away])
            h2h_map[key] = {"team_a": ta, "team_b": tb,
                            "season_h2h": {}, "all_time_h2h": {}, "games": []}
        h2h_map[key]["games"].append(game)

    print(f"  → {len(h2h_map)}개 맞대결 조합, {len(completed)}경기 수집 예정")

    for key, h2h_info in h2h_map.items():
        out = H2H_DIR / f"{key}.json"
        season_h2h_latest = {}
        all_time_h2h_latest = {}
        enriched_games = []

        for game in h2h_info["games"]:
            try:
                soup = ajax_post(session, f"{BASE_URL}/game/ajax/ajax_game_result_1.asp", {
                    "season_gu": SEASON_CODE,
                    "game_type": "01",
                    "game_no":   game["game_no"],
                    "ym":        game["ym"],
                    "h_player":  "",
                    "a_player":  "",
                })

                parsed = _parse_h2h_ajax(soup, game["game_no"])
                if parsed:
                    season_h2h_latest   = parsed["season_h2h"]   or season_h2h_latest
                    all_time_h2h_latest = parsed["all_time_h2h"] or all_time_h2h_latest
                    enriched_games.append({
                        "date":    game["date"],
                        "venue":   game.get("venue", ""),
                        "result":  parsed["season_record"],
                        "game_no": game["game_no"],
                    })
                else:
                    enriched_games.append({
                        "date":    game["date"],
                        "venue":   game.get("venue", ""),
                        "result":  {},
                        "game_no": game["game_no"],
                    })

                time.sleep(0.3)
            except Exception as e:
                print(f"[WARN] 경기결과 수집 실패 (game_no={game['game_no']}): {e}")

        data = {
            "updated":      now_kst(),
            "team_a":       h2h_info["team_a"],
            "team_b":       h2h_info["team_b"],
            "season_h2h":   season_h2h_latest,
            "all_time_h2h": all_time_h2h_latest,
            "games":        enriched_games,
        }
        save_json(out, data)


# ─── 메타 ─────────────────────────────────────────────────────────────────────
def write_meta():
    data = {
        "last_updated": now_kst(),
        "season":       "2025-2026",
        "season_code":  SEASON_CODE,
    }
    save_json(DATA_DIR / "meta.json", data)


# ─── main ─────────────────────────────────────────────────────────────────────
def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    H2H_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 50)
    print("WKBL 데이터 수집 시작")
    print("=" * 50)

    session = create_session()

    try:
        print("\n[1/5] 팀 순위 수집 중...")
        collect_standings(session)
    except Exception as e:
        print(f"[WARN] 팀 순위 단계 오류: {e}")

    schedule_data = None
    try:
        print("\n[2/5] 경기 일정 수집 중...")
        schedule_data = collect_schedule(session)
    except Exception as e:
        print(f"[WARN] 경기 일정 단계 오류: {e}")

    try:
        print("\n[3/5] 선수 기록 수집 중...")
        collect_player_records(session)
    except Exception as e:
        print(f"[WARN] 선수 기록 단계 오류: {e}")

    try:
        print("\n[4/5] 맞대결 데이터 수집 중...")
        collect_h2h_results(session, schedule_data)
    except Exception as e:
        print(f"[WARN] 맞대결 데이터 단계 오류: {e}")

    try:
        print("\n[5/5] 메타 파일 작성 중...")
        write_meta()
    except Exception as e:
        print(f"[WARN] 메타 파일 단계 오류: {e}")

    print("\n" + "=" * 50)
    print("WKBL 데이터 수집 완료")
    print("=" * 50)


if __name__ == "__main__":
    main()
