'use strict';

// ─── 팀 컬러 매핑 ─────────────────────────────────────────────────────────────
const TEAM_COLORS = {
  "KB스타즈":  "#1E3A8A",
  "하나은행":  "#00704A",
  "삼성생명":  "#C8102E",
  "BNK 썸":   "#E85D04",
  "우리은행":  "#004EA2",
  "신한은행":  "#E8192C",
};

// "87승 99패" → {wins:87, losses:99}
function parseWinLoss(str) {
  if (!str) return null;
  const m = str.match(/(\d+)승\s*(\d+)패/);
  return m ? { wins: parseInt(m[1]), losses: parseInt(m[2]) } : null;
}

// 순위표에서 부제 포함 팀명(예: "삼성생명 블루밍스") → 정식 팀명 정규화
function normalizeTeam(name) {
  if (!name) return name;
  // 완전 일치
  if (TEAM_COLORS[name]) return name;
  // 정식 팀명이 접두어로 포함된 경우
  for (const k of Object.keys(TEAM_COLORS)) {
    if (name.startsWith(k)) return k;
  }
  return name;
}

// ─── 전역 캐시 ─────────────────────────────────────────────────────────────────
let standingsData     = null;
let scheduleData      = null;
let playerRecordsData = null;
let currentMonthGames = [];   // renderMonthGames 의 클로저용

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
function getTeamColor(name) {
  return TEAM_COLORS[normalizeTeam(name)] || "#888";
}

function formatLast5Badges(str) {
  if (!str || !str.includes("-")) return `<span>${str || "-"}</span>`;
  const [wins, losses] = str.split("-").map(Number);
  let html = '<span class="badge-wrap">';
  for (let i = 0; i < Math.min(wins, 5); i++)              html += '<span class="badge badge-w">W</span>';
  for (let i = 0; i < Math.min(losses, 5 - wins); i++)     html += '<span class="badge badge-l">L</span>';
  html += '</span>';
  return html;
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr + "T00:00:00+09:00");
  if (isNaN(d)) return dateStr;
  const days = ["일","월","화","수","목","금","토"];
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
}

function formatFullDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr + "T00:00:00+09:00");
  if (isNaN(d)) return dateStr;
  const days = ["일","월","화","수","목","금","토"];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

function ymLabel(ym) {
  const y = ym.slice(0, 4);
  const m = parseInt(ym.slice(4));
  return `${y.slice(2)}.${m}월`;
}

function getStandingRow(teamName) {
  if (!standingsData || !standingsData.rows) return null;
  const canon = normalizeTeam(teamName);
  return standingsData.rows.find(r => normalizeTeam(r[1]) === canon) || null;
}

function getRecentGames(teamName, n = 3, beforeDate = null) {
  // beforeDate: 이 날짜보다 이전 경기만 (해당 게임 직전 컨디션 파악용)
  if (!scheduleData) return [];
  const canon = normalizeTeam(teamName);
  return scheduleData.games
    .filter(g => g.is_completed &&
      (normalizeTeam(g.home_team) === canon || normalizeTeam(g.away_team) === canon) &&
      (!beforeDate || g.date < beforeDate))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);
}

// ─── 데이터 로딩 ───────────────────────────────────────────────────────────────
async function loadMeta() {
  try {
    const data = await fetch("data/meta.json").then(r => r.json());
    const el = document.getElementById("last-updated");
    if (el && data.last_updated) {
      const dt = new Date(data.last_updated);
      const kstStr = dt.toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit",
      });
      el.textContent = `마지막 업데이트: ${kstStr} KST`;
    }
  } catch (e) {
    console.warn("meta.json 로드 실패:", e);
  }
}

async function loadStandings() {
  try {
    standingsData = await fetch("data/standings.json").then(r => r.json());
    renderStandingsTable(standingsData);
  } catch (e) {
    console.warn("standings.json 로드 실패:", e);
    document.getElementById("standings-container").innerHTML =
      '<p class="error-msg">순위 데이터를 불러올 수 없습니다.</p>';
  }
}

async function loadSchedule() {
  try {
    scheduleData = await fetch("data/schedule.json").then(r => r.json());
    renderScheduleTable(scheduleData);
    populateTeamDropdowns(scheduleData);
  } catch (e) {
    console.warn("schedule.json 로드 실패:", e);
    document.getElementById("schedule-container").innerHTML =
      '<p class="error-msg">일정 데이터를 불러올 수 없습니다.</p>';
  }
}

async function loadPlayerRecords() {
  try {
    playerRecordsData = await fetch("data/player_records.json").then(r => r.json());
  } catch (e) {
    console.warn("player_records.json 로드 실패:", e);
  }
}

// ─── 드롭다운 구성 ─────────────────────────────────────────────────────────────
function populateTeamDropdowns(schedData) {
  // schedule.json 의 팀명(정식명)을 사용 → standings 부제 문제 없음
  const teams = new Set();
  (schedData.games || []).forEach(g => {
    if (g.home_team) teams.add(g.home_team);
    if (g.away_team) teams.add(g.away_team);
  });

  const sorted = [...teams].sort((a, b) => a.localeCompare(b, "ko"));
  const selA = document.getElementById("select-team-a");
  const selB = document.getElementById("select-team-b");

  sorted.forEach(name => {
    selA.add(new Option(name, name));
    selB.add(new Option(name, name));
  });

  updateBriefingButton();
}

function updateBriefingButton() {
  const a = document.getElementById("select-team-a").value;
  const b = document.getElementById("select-team-b").value;
  document.getElementById("btn-briefing").disabled = !a || !b || a === b;
}

// ─── 순위 테이블 렌더 ──────────────────────────────────────────────────────────
function renderStandingsTable(data) {
  const container = document.getElementById("standings-container");
  if (!data || !data.rows || !data.rows.length) {
    container.innerHTML = '<p class="error-msg">순위 데이터가 없습니다.</p>';
    return;
  }

  const headers = data.headers || [];
  let html = '<div class="table-wrap"><table id="standings-table"><thead><tr>';
  headers.forEach(h => { html += `<th>${escHtml(h)}</th>`; });
  html += "</tr></thead><tbody>";

  data.rows.forEach(row => {
    const teamFull = row[1] || "";
    const teamCanon = normalizeTeam(teamFull);
    const color = getTeamColor(teamCanon);
    // data-team 에는 정식 팀명 저장 (드롭다운 값과 일치)
    html += `<tr data-team="${escHtml(teamCanon)}">`;
    row.forEach((cell, idx) => {
      if (idx === 0) {
        html += `<td class="rank">${escHtml(cell)}</td>`;
      } else if (idx === 1) {
        html += `<td class="team-name" style="border-left:3px solid ${color}">${escHtml(cell)}</td>`;
      } else if (headers[idx] === "LAST5") {
        html += `<td>${formatLast5Badges(cell)}</td>`;
      } else {
        html += `<td>${escHtml(cell)}</td>`;
      }
    });
    html += "</tr>";
  });

  html += "</tbody></table></div>";
  container.innerHTML = html;
}

// ─── 일정: 월별 탭 ─────────────────────────────────────────────────────────────
function renderScheduleTable(data) {
  const container = document.getElementById("schedule-container");
  if (!data || !data.games || !data.games.length) {
    container.innerHTML = '<p class="error-msg">일정 데이터가 없습니다.</p>';
    return;
  }

  // 경기가 있는 달만 수집 (정렬)
  const months = [];
  const seen = new Set();
  data.games.forEach(g => {
    if (g.ym && !seen.has(g.ym)) { seen.add(g.ym); months.push(g.ym); }
  });
  months.sort();

  // 기본 선택 달: 예정 경기가 있는 첫 달
  let defaultYm = months[months.length - 1];
  for (const ym of months) {
    if (data.games.some(g => g.ym === ym && !g.is_completed)) { defaultYm = ym; break; }
  }

  // 탭 렌더
  let html = '<div class="month-tabs">';
  months.forEach(ym => {
    html += `<button class="month-tab${ym === defaultYm ? " active" : ""}" data-ym="${escHtml(ym)}">${escHtml(ymLabel(ym))}</button>`;
  });
  html += '</div><div id="month-games-container"></div>';
  container.innerHTML = html;

  container.querySelectorAll(".month-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".month-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderMonthGames(btn.dataset.ym);
    });
  });

  renderMonthGames(defaultYm);
}

function renderMonthGames(ym) {
  const wrap = document.getElementById("month-games-container");
  if (!scheduleData || !wrap) return;

  const games = scheduleData.games.filter(g => g.ym === ym);
  const completed = games.filter(g => g.is_completed).sort((a, b) => b.date.localeCompare(a.date));
  const upcoming  = games.filter(g => !g.is_completed).sort((a, b) => a.date.localeCompare(b.date));
  const sorted = [...completed, ...upcoming];
  currentMonthGames = sorted;

  if (!sorted.length) {
    wrap.innerHTML = '<p class="loading">이 달 경기가 없습니다.</p>';
    return;
  }

  let html = '<div class="table-wrap"><table id="schedule-table">'
    + '<thead><tr><th>날짜</th><th>시간</th><th>홈팀</th><th>VS</th><th>원정팀</th><th>장소</th><th>결과</th></tr></thead><tbody>';

  sorted.forEach((g, i) => {
    const done = g.is_completed;
    const colorH = getTeamColor(g.home_team);
    const colorA = getTeamColor(g.away_team);

    let resultHtml;
    if (done && g.home_score && g.away_score) {
      resultHtml = `<span style="color:${colorH};font-weight:700">${escHtml(g.home_score)}</span>`
                 + `<span style="color:var(--muted);margin:0 3px">:</span>`
                 + `<span style="color:${colorA};font-weight:700">${escHtml(g.away_score)}</span>`;
    } else {
      resultHtml = done ? "완료" : '<span class="upcoming-badge">예정</span>';
    }

    // 날짜 구분선: 완료→예정 경계
    const prevDone = i > 0 ? sorted[i - 1].is_completed : done;
    const separator = (i > 0 && prevDone && !done)
      ? '<tr class="section-separator"><td colspan="7"></td></tr>' : "";

    html += separator;
    html += `<tr class="game-row${done ? " completed" : " upcoming"}" data-idx="${i}" style="cursor:pointer">`;
    html += `<td>${escHtml(formatDate(g.date))}</td>`;
    html += `<td>${escHtml(g.time || "-")}</td>`;
    html += `<td class="team-cell" style="font-weight:600;border-left:3px solid ${colorH}">${escHtml(g.home_team)}</td>`;
    html += `<td style="color:var(--muted)">VS</td>`;
    html += `<td class="team-cell" style="font-weight:600;border-left:3px solid ${colorA}">${escHtml(g.away_team)}</td>`;
    html += `<td>${escHtml(g.venue || "-")}</td>`;
    html += `<td class="result-cell">${resultHtml}</td>`;
    html += "</tr>";
  });

  html += "</tbody></table></div>";
  wrap.innerHTML = html;

  wrap.querySelectorAll("tr.game-row").forEach(tr => {
    tr.addEventListener("click", () => {
      const idx = parseInt(tr.dataset.idx, 10);
      openGameModal(currentMonthGames[idx]);
    });
  });
}

// ─── 게임 모달 ─────────────────────────────────────────────────────────────────
async function openGameModal(game) {
  const modal   = document.getElementById("game-modal");
  const content = document.getElementById("modal-content");

  content.innerHTML = '<p class="loading" style="padding:48px;text-align:center">데이터 로딩 중...</p>';
  modal.removeAttribute("hidden");
  document.body.style.overflow = "hidden";

  // H2H 데이터 fetch (정식 팀명으로 정규화)
  const homeCanon = normalizeTeam(game.home_team);
  const awayCanon = normalizeTeam(game.away_team);
  const [t1, t2] = [homeCanon, awayCanon].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const filename = `${t1}_vs_${t2}.json`;
  let h2hData = null;
  try {
    h2hData = await fetch(`data/h2h/${encodeURIComponent(filename)}`).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  } catch (e) {
    console.warn("H2H 데이터 없음:", filename);
  }

  // 텍스트 복사 버튼용 참조 저장
  _currentModalGame = game;
  _currentModalH2H  = h2hData;
  content.innerHTML = buildModalContent(game, h2hData);
}

function closeGameModal() {
  const modal = document.getElementById("game-modal");
  modal.setAttribute("hidden", "");
  document.body.style.overflow = "";
}

function buildModalContent(game, h2hData) {
  const homeTeam   = normalizeTeam(game.home_team);
  const awayTeam   = normalizeTeam(game.away_team);
  const colorH     = getTeamColor(homeTeam);
  const colorA     = getTeamColor(awayTeam);
  const done       = game.is_completed;
  const cutoffDate = game.date;  // 이 날짜까지 기준

  const homeRow  = getStandingRow(homeTeam);
  const awayRow  = getStandingRow(awayTeam);

  // 점수 조회 맵 (game_no → schedule game)
  const scoreByGameNo = {};
  if (scheduleData) {
    scheduleData.games.forEach(sg => {
      if (sg.game_no && sg.home_score && sg.away_score) scoreByGameNo[sg.game_no] = sg;
    });
  }

  // ── 헤더 ──
  let html = `<div class="modal-header">
    <div class="modal-title">${done ? "경기 결과" : "경기 프리뷰"}</div>
    <div class="modal-meta">
      <span>${escHtml(formatFullDate(game.date))}</span>
      ${game.time ? `<span class="modal-time-badge">${escHtml(game.time)}</span>` : ""}
    </div>
    ${game.venue ? `<div class="modal-venue">${escHtml(game.venue)}</div>` : ""}
  </div>`;

  // ── 팀 매치업 ──
  const homeRecord = homeRow ? `${homeRow[0]}위 ${homeRow[3] || ""}` : "";
  const awayRecord = awayRow ? `${awayRow[0]}위 ${awayRow[3] || ""}` : "";
  const homeLast5  = homeRow ? formatLast5Badges(homeRow[9] || "") : "";
  const awayLast5  = awayRow ? formatLast5Badges(awayRow[9] || "") : "";

  html += `<div class="modal-matchup">
    <div class="modal-team-card" style="border-top:4px solid ${colorH}">
      <div class="modal-team-name" style="color:${colorH}">${escHtml(homeTeam)}</div>
      <div class="modal-team-label">홈</div>
      <div class="modal-team-record">${escHtml(homeRecord)}</div>
      <div>${homeLast5}</div>
    </div>
    <div class="modal-vs-col">`;

  if (done && game.home_score && game.away_score) {
    const homeWin = parseInt(game.home_score) > parseInt(game.away_score);
    html += `<div class="modal-score">
      <span style="color:${colorH};font-size:28px;font-weight:800${homeWin ? "" : ";opacity:.6"}">${escHtml(game.home_score)}</span>
      <span style="color:var(--muted);font-size:20px;margin:0 6px">:</span>
      <span style="color:${colorA};font-size:28px;font-weight:800${!homeWin ? "" : ";opacity:.6"}">${escHtml(game.away_score)}</span>
    </div>`;
    if (game.mvp) {
      html += `<div class="modal-mvp">MVP: ${escHtml(game.mvp)}</div>`;
    }
  } else {
    html += `<div class="modal-vs-text">VS</div>`;
  }

  html += `</div>
    <div class="modal-team-card" style="border-top:4px solid ${colorA}">
      <div class="modal-team-name" style="color:${colorA}">${escHtml(awayTeam)}</div>
      <div class="modal-team-label">원정</div>
      <div class="modal-team-record">${escHtml(awayRecord)}</div>
      <div>${awayLast5}</div>
    </div>
  </div>`;

  // ── 상대전적 (cutoffDate 이하 경기 기준으로 재계산) ──
  if (h2hData) {
    const allTimeH2H = h2hData.all_time_h2h || {};

    // 이 경기 날짜까지의 맞대결만 필터
    const h2hGames = (h2hData.games || []).filter(g => g.date <= cutoffDate);

    // 시즌 전적: cutoffDate 이하 경기 기반 재계산
    let homeWins = 0, awayWins = 0;
    h2hGames.forEach(g => {
      const sc = scoreByGameNo[g.game_no];
      if (!sc) return;
      const isHomeH = normalizeTeam(sc.home_team) === homeTeam;
      const hScore  = parseInt(isHomeH ? sc.home_score : sc.away_score);
      const aScore  = parseInt(isHomeH ? sc.away_score : sc.home_score);
      if (!isNaN(hScore) && !isNaN(aScore)) {
        if (hScore > aScore) homeWins++; else awayWins++;
      }
    });
    const totalPlayed = homeWins + awayWins;
    const computedH2H = totalPlayed > 0
      ? { [homeTeam]: `${homeWins}승 ${awayWins}패`, [awayTeam]: `${awayWins}승 ${homeWins}패` }
      : { [homeTeam]: "-", [awayTeam]: "-" };

    // 통산 전적: 현재값에서 cutoffDate 이후 경기 수 빼서 역산
    const postGames = (h2hData.games || []).filter(g => g.date > cutoffDate);
    let postHomeWins = 0, postAwayWins = 0;
    postGames.forEach(g => {
      const sc = scoreByGameNo[g.game_no];
      if (!sc) return;
      const isHomeH = normalizeTeam(sc.home_team) === homeTeam;
      const hScore  = parseInt(isHomeH ? sc.home_score : sc.away_score);
      const aScore  = parseInt(isHomeH ? sc.away_score : sc.home_score);
      if (!isNaN(hScore) && !isNaN(aScore)) {
        if (hScore > aScore) postHomeWins++; else postAwayWins++;
      }
    });
    const homeAllTime = parseWinLoss(allTimeH2H[homeTeam]);
    const awayAllTime = parseWinLoss(allTimeH2H[awayTeam]);
    let adjustedAllTimeH = "-", adjustedAllTimeA = "-";
    if (homeAllTime) {
      adjustedAllTimeH = `${homeAllTime.wins - postHomeWins}승 ${homeAllTime.losses - postAwayWins}패`;
      adjustedAllTimeA = `${homeAllTime.losses - postAwayWins - (homeAllTime.losses - postAwayWins - (homeAllTime.losses - postAwayWins))}승 ${homeAllTime.wins - postHomeWins}패`;
    }
    if (awayAllTime) {
      adjustedAllTimeA = `${awayAllTime.wins - postAwayWins}승 ${awayAllTime.losses - postHomeWins}패`;
    }

    html += `<div class="modal-section">
      <div class="modal-section-title">상대전적 (${cutoffDate} 기준)</div>
      <div class="modal-h2h-row">
        <div class="modal-h2h-item">
          <div class="mh-label">시즌 상대전적</div>
          <div class="mh-val">
            <span style="color:${colorH}">${escHtml(computedH2H[homeTeam])}</span>
            <span style="color:var(--muted)"> / </span>
            <span style="color:${colorA}">${escHtml(computedH2H[awayTeam])}</span>
          </div>
        </div>
        <div class="modal-h2h-item">
          <div class="mh-label">통산 상대전적</div>
          <div class="mh-val">
            <span style="color:${colorH}">${escHtml(adjustedAllTimeH)}</span>
            <span style="color:var(--muted)"> / </span>
            <span style="color:${colorA}">${escHtml(adjustedAllTimeA)}</span>
          </div>
        </div>
      </div>
    </div>`;

    // 이번 시즌 맞대결 기록 (cutoffDate 이하)
    if (h2hGames.length) {
      html += `<div class="modal-section">
        <div class="modal-section-title">이번 시즌 맞대결 기록</div>
        <div class="table-wrap"><table><thead><tr>
          <th>날짜</th>
          <th style="color:${colorH}">${escHtml(homeTeam)}</th>
          <th>점수</th>
          <th style="color:${colorA}">${escHtml(awayTeam)}</th>
          <th>MVP</th>
        </tr></thead><tbody>`;

      h2hGames.slice().reverse().forEach(g => {
        const sc = scoreByGameNo[g.game_no];
        let scoreHtml = "-";
        let homeResult = "-", awayResult = "-";
        if (sc) {
          const isHomeH = normalizeTeam(sc.home_team) === homeTeam;
          const hScore = isHomeH ? sc.home_score : sc.away_score;
          const aScore = isHomeH ? sc.away_score : sc.home_score;
          const hWin = parseInt(hScore) > parseInt(aScore);
          scoreHtml = `<span style="color:${colorH};font-weight:700">${escHtml(hScore)}</span>`
                    + `<span style="color:var(--muted)">:</span>`
                    + `<span style="color:${colorA};font-weight:700">${escHtml(aScore)}</span>`;
          homeResult = `<span style="color:${hWin ? "#16a34a" : "#dc2626"};font-weight:600">${hWin ? "승" : "패"}</span>`;
          awayResult = `<span style="color:${!hWin ? "#16a34a" : "#dc2626"};font-weight:600">${!hWin ? "승" : "패"}</span>`;
        }
        html += `<tr>
          <td>${escHtml(formatDate(g.date))}</td>
          <td>${homeResult}</td>
          <td>${scoreHtml}</td>
          <td>${awayResult}</td>
          <td style="font-size:11px;color:var(--muted)">${escHtml(g.mvp || "-")}</td>
        </tr>`;
      });

      html += "</tbody></table></div></div>";
    }
  }

  // ── 최근 3경기 (이 경기 이전 경기만) ──
  const homeRecent = getRecentGames(homeTeam, 3, cutoffDate);
  const awayRecent = getRecentGames(awayTeam, 3, cutoffDate);
  if (homeRecent.length || awayRecent.length) {
    const buildRecentTable = (teamName, recentGames, color) => {
      let t = `<div class="modal-recent-col">
        <div class="modal-recent-title" style="color:${color}">${escHtml(teamName)} 최근 3경기</div>
        <div class="table-wrap"><table><thead><tr><th>날짜</th><th>상대</th><th>결과</th></tr></thead><tbody>`;
      recentGames.forEach(g => {
        const canon = normalizeTeam(teamName);
        const isHome = normalizeTeam(g.home_team) === canon;
        const opp = isHome ? g.away_team : g.home_team;
        const myScore  = isHome ? g.home_score : g.away_score;
        const oppScore = isHome ? g.away_score : g.home_score;
        const won = parseInt(myScore) > parseInt(oppScore);
        t += `<tr>
          <td>${escHtml(formatDate(g.date))}</td>
          <td style="color:${getTeamColor(opp)}">${escHtml(opp)}</td>
          <td style="color:${won ? "#16a34a" : "#dc2626"};font-weight:600">${escHtml(myScore)}:${escHtml(oppScore)} ${won ? "승" : "패"}</td>
        </tr>`;
      });
      t += "</tbody></table></div></div>";
      return t;
    };

    html += `<div class="modal-section">
      <div class="modal-section-title">최근 3경기</div>
      <div class="modal-two-col">
        ${buildRecentTable(homeTeam, homeRecent, colorH)}
        ${buildRecentTable(awayTeam, awayRecent, colorA)}
      </div>
    </div>`;
  }

  // ── 득점 순위 ──
  if (playerRecordsData && playerRecordsData["득점"]) {
    const { headers, rows } = playerRecordsData["득점"];
    const avgIdx = headers.indexOf("평균득점");

    const getTeamPlayers = (team) => {
      const canon = normalizeTeam(team);
      return rows.filter(r => normalizeTeam(r[2]) === canon).slice(0, 5);
    };

    const homePlayers = getTeamPlayers(homeTeam);
    const awayPlayers = getTeamPlayers(awayTeam);

    if (homePlayers.length || awayPlayers.length) {
      const buildPlayerTable = (teamName, players, color) => {
        let t = `<div class="modal-recent-col">
          <div class="modal-recent-title" style="color:${color}">${escHtml(teamName)} 득점</div>
          <div class="table-wrap"><table><thead><tr><th>순위</th><th>선수</th><th>평균</th></tr></thead><tbody>`;
        players.forEach(r => {
          t += `<tr><td>${escHtml(r[0])}</td><td>${escHtml(r[1])}</td><td>${escHtml(avgIdx >= 0 ? r[avgIdx] : "-")}</td></tr>`;
        });
        t += "</tbody></table></div></div>";
        return t;
      };

      html += `<div class="modal-section">
        <div class="modal-section-title">득점 순위</div>
        <div class="modal-two-col">
          ${buildPlayerTable(homeTeam, homePlayers, colorH)}
          ${buildPlayerTable(awayTeam, awayPlayers, colorA)}
        </div>
      </div>`;
    }
  }

  // ── 액션 버튼 + AI 출력 영역 + 출처 ──
  html += `<div class="modal-actions">
    <button class="modal-action-btn" onclick="copyBriefingText(this, false)">📋 데이터 텍스트 복사</button>
    <button class="modal-action-btn accent" id="ai-generate-btn" onclick="handleAIGenerate(this)">✨ AI 해설 스크립트 생성</button>
  </div>
  <div id="ai-script-output" class="ai-script-output" style="display:none">
    <div class="ai-script-header">
      <span>✨ AI 해설 스크립트</span>
      <button class="ai-copy-btn" onclick="copyAIScript(this)">복사</button>
    </div>
    <div id="ai-script-content" class="ai-script-content"></div>
  </div>
  <div class="modal-source">
    출처: <a href="https://www.wkbl.or.kr" target="_blank" rel="noopener noreferrer">wkbl.or.kr</a>
  </div>`;

  return html;
}

// ─── 브리핑 텍스트 / AI 프롬프트 생성 ────────────────────────────────────────
function buildBriefingPlainText(game, h2hData) {
  const homeTeam   = normalizeTeam(game.home_team);
  const awayTeam   = normalizeTeam(game.away_team);
  const homeRow    = getStandingRow(homeTeam);
  const awayRow    = getStandingRow(awayTeam);
  const done       = game.is_completed;
  const cutoffDate = game.date;

  // 점수 조회 맵
  const scoreByGameNo = {};
  if (scheduleData) {
    scheduleData.games.forEach(sg => {
      if (sg.game_no && sg.home_score && sg.away_score) scoreByGameNo[sg.game_no] = sg;
    });
  }

  const lines = [];
  lines.push("══════════════════════════════════════════");
  lines.push(`■ ${done ? "경기 결과" : "경기 프리뷰"}: ${homeTeam} vs ${awayTeam}`);
  lines.push("══════════════════════════════════════════");
  lines.push("");
  lines.push("[경기 정보]");
  lines.push(`• 일시: ${formatFullDate(game.date)}${game.time ? " " + game.time : ""}`);
  if (game.venue) lines.push(`• 장소: ${game.venue}`);

  lines.push("");
  lines.push("[현재 순위]");
  if (homeRow) lines.push(`• ${homeTeam} (홈): ${homeRow[0]}위 ${homeRow[3] || ""} | LAST5: ${homeRow[9] || "-"} | 연속: ${homeRow[10] || "-"}`);
  if (awayRow) lines.push(`• ${awayTeam} (원정): ${awayRow[0]}위 ${awayRow[3] || ""} | LAST5: ${awayRow[9] || "-"} | 연속: ${awayRow[10] || "-"}`);

  if (done && game.home_score && game.away_score) {
    lines.push("");
    lines.push("[경기 결과]");
    lines.push(`• ${homeTeam} ${game.home_score} : ${game.away_score} ${awayTeam}`);
    if (game.mvp) lines.push(`• MVP: ${game.mvp}`);
  }

  if (h2hData) {
    const allTimeH2H = h2hData.all_time_h2h || {};
    // cutoffDate 이하 맞대결만 필터 후 시즌 전적 재계산
    const h2hGames = (h2hData.games || []).filter(g => g.date <= cutoffDate);
    let homeWins = 0, awayWins = 0;
    h2hGames.forEach(g => {
      const sc = scoreByGameNo[g.game_no];
      if (!sc) return;
      const isHomeH = normalizeTeam(sc.home_team) === homeTeam;
      const hScore  = parseInt(isHomeH ? sc.home_score : sc.away_score);
      const aScore  = parseInt(isHomeH ? sc.away_score : sc.home_score);
      if (!isNaN(hScore) && !isNaN(aScore)) {
        if (hScore > aScore) homeWins++; else awayWins++;
      }
    });

    lines.push("");
    lines.push(`[상대전적 (${cutoffDate} 기준)]`);
    lines.push(`• 시즌: ${homeTeam} ${homeWins}승 ${awayWins}패 / ${awayTeam} ${awayWins}승 ${homeWins}패`);
    lines.push(`• 통산: ${homeTeam} ${allTimeH2H[homeTeam] || "-"} / ${awayTeam} ${allTimeH2H[awayTeam] || "-"}`);

    if (h2hGames.length) {
      lines.push("");
      lines.push("[이번 시즌 맞대결 기록]");
      h2hGames.forEach(g => {
        const sc = scoreByGameNo[g.game_no];
        let scorePart = "";
        if (sc) {
          const isHomeH = normalizeTeam(sc.home_team) === homeTeam;
          const hScore = isHomeH ? sc.home_score : sc.away_score;
          const aScore = isHomeH ? sc.away_score : sc.home_score;
          const winner = parseInt(hScore) > parseInt(aScore) ? homeTeam : awayTeam;
          scorePart = ` ${homeTeam} ${hScore}-${aScore} ${awayTeam} → ${winner} 승`;
        }
        const mvpPart = g.mvp ? ` | MVP: ${g.mvp}` : "";
        lines.push(`• ${formatDate(g.date)}${scorePart}${mvpPart}`);
      });
    }
  }

  // 최근 3경기 (이 경기 이전 기준)
  const buildRecentText = (teamName, label) => {
    const recent = getRecentGames(teamName, 3, cutoffDate);
    if (!recent.length) return;
    lines.push("");
    lines.push(`[${label} 최근 3경기]`);
    recent.forEach(g => {
      const canon = normalizeTeam(teamName);
      const isHome = normalizeTeam(g.home_team) === canon;
      const opp    = isHome ? g.away_team : g.home_team;
      const myScore  = isHome ? g.home_score : g.away_score;
      const oppScore = isHome ? g.away_score : g.home_score;
      const result   = parseInt(myScore) > parseInt(oppScore) ? "승" : "패";
      const loc = isHome ? "(홈)" : "(원정)";
      lines.push(`• ${formatDate(g.date)} vs ${opp}${loc}: ${myScore}-${oppScore} ${result}${g.mvp ? " | MVP: " + g.mvp : ""}`);
    });
  };
  buildRecentText(homeTeam, homeTeam);
  buildRecentText(awayTeam, awayTeam);

  // 득점 순위
  if (playerRecordsData && playerRecordsData["득점"]) {
    const { headers, rows } = playerRecordsData["득점"];
    const avgIdx = headers.indexOf("평균득점");
    const buildPlayerText = (teamName) => {
      const canon = normalizeTeam(teamName);
      const players = rows.filter(r => normalizeTeam(r[2]) === canon).slice(0, 5);
      if (!players.length) return;
      lines.push("");
      lines.push(`[${teamName} 득점 순위 TOP5]`);
      players.forEach(r => {
        const avg = avgIdx >= 0 ? r[avgIdx] : "-";
        lines.push(`• ${r[0]}위 ${r[1]} — 평균 ${avg}점`);
      });
    };
    buildPlayerText(homeTeam);
    buildPlayerText(awayTeam);
  }

  lines.push("");
  lines.push("출처: wkbl.or.kr");
  lines.push("══════════════════════════════════════════");
  return lines.join("\n");
}

function buildAIPromptText(game, h2hData) {
  const homeTeam = normalizeTeam(game.home_team);
  const awayTeam = normalizeTeam(game.away_team);
  const dataText = buildBriefingPlainText(game, h2hData);

  return `아래 WKBL 경기 데이터를 바탕으로 TV 해설위원이 실제로 읽을 수 있는 브리핑 스크립트를 한국어로 작성해주세요.

■ 출력 형식 (반드시 이 순서로):

[경기 개요]
• 일시/장소, 양 팀 현재 순위·성적
• 특이사항: 이 경기의 리그 순위·우승·플레이오프 진출에 미치는 영향

[이전 라운드 맞대결 복기]
• 시즌 상대전적 요약
• 날짜별 스코어와 승패, 경기 흐름 한 줄 코멘트

[양 팀 직전 경기 요약]
• 각 팀 가장 최근 경기 결과, 주목 선수 컨디션

[승부처 요약]
• 이 경기의 핵심 매치업·변수 3가지 (선수 이름 명시)

[주요 기록 (Fact)]
• 주목할 선수 스탯, 팀 지표

[해설 포인트 제안]
• 오프닝 멘트 (30초 분량 스크립트)
• 클로징 멘트 (20초 분량 스크립트)

■ 작성 원칙:
- 데이터는 아래 제공된 WKBL 공식 데이터를 우선 사용
- 선수명·팀명·스코어는 데이터와 정확히 일치해야 함
- 해설 포인트는 실제 방송 해설위원이 바로 읽을 수 있는 자연스러운 한국어 구어체로

━━━━━━━━ 경기 데이터 ━━━━━━━━

${dataText}`;
}

// ─── Claude API 직접 호출 ─────────────────────────────────────────────────────
async function handleAIGenerate(btn) {
  let apiKey = localStorage.getItem("claude_api_key");

  if (!apiKey) {
    const key = prompt(
      "Claude API 키를 입력하세요.\n" +
      "(브라우저 localStorage에만 저장됩니다)\n\n" +
      "발급: https://console.anthropic.com/settings/keys"
    );
    if (!key || !key.trim()) return;
    apiKey = key.trim();
    localStorage.setItem("claude_api_key", apiKey);
  }

  await generateAIBriefing(btn, apiKey, _currentModalGame, _currentModalH2H);
}

async function generateAIBriefing(btn, apiKey, game, h2hData) {
  const output  = document.getElementById("ai-script-output");
  const content = document.getElementById("ai-script-content");

  output.style.display = "block";
  content.textContent  = "";
  content.style.color  = "";
  btn.disabled    = true;
  btn.textContent = "⏳ 생성 중...";
  output.scrollIntoView({ behavior: "smooth", block: "nearest" });

  const promptText = buildAIPromptText(game, h2hData);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "x-api-key":     apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-6",
        max_tokens: 2048,
        stream:     true,
        messages:   [{ role: "user", content: promptText }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401) {
        localStorage.removeItem("claude_api_key");
        throw new Error("API 키가 올바르지 않습니다. 다시 시도하면 재입력 창이 열립니다.");
      }
      throw new Error(err.error?.message || `API 오류 (${res.status})`);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let text = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const json = JSON.parse(raw);
          if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
            text += json.delta.text;
            content.textContent = text;
          }
        } catch {}
      }
    }

    btn.textContent = "✅ 생성 완료";
    setTimeout(() => { btn.textContent = "✨ AI 해설 스크립트 생성"; btn.disabled = false; }, 3000);

  } catch (e) {
    content.style.color = "#f87171";
    content.textContent = `오류: ${e.message}`;
    btn.textContent = "✨ AI 해설 스크립트 생성";
    btn.disabled = false;
  }
}

function copyAIScript(btn) {
  const text = document.getElementById("ai-script-content")?.textContent || "";
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = "✅ 복사됨!";
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
}

function showApiKeySettings() {
  const cur = localStorage.getItem("claude_api_key");
  const hint = cur ? `현재 키: ${cur.slice(0, 15)}...` : "(설정되지 않음)";
  const key = prompt(`Claude API 키 설정\n${hint}\n\n새 키 입력 (비우면 삭제):`);
  if (key === null) return;
  if (key.trim()) {
    localStorage.setItem("claude_api_key", key.trim());
  } else {
    localStorage.removeItem("claude_api_key");
  }
}

// currentModal 에 저장된 game·h2h 참조
let _currentModalGame = null;
let _currentModalH2H  = null;

function copyBriefingText(btn, asAIPrompt) {
  const text = asAIPrompt
    ? buildAIPromptText(_currentModalGame, _currentModalH2H)
    : buildBriefingPlainText(_currentModalGame, _currentModalH2H);

  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = "✅ 복사됨!";
    btn.disabled = true;
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
  }).catch(() => {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    const orig = btn.textContent;
    btn.textContent = "✅ 복사됨!";
    btn.disabled = true;
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
  });
}

// ─── 브리핑 패널 (팀 선택 섹션) ───────────────────────────────────────────────
async function showBriefing(teamA, teamB) {
  // 부제 포함 팀명("삼성생명 블루밍스" 등) → 정식명 정규화
  teamA = normalizeTeam(teamA);
  teamB = normalizeTeam(teamB);

  const panel = document.getElementById("briefing-panel");
  panel.classList.remove("visible");
  panel.innerHTML = '<p class="loading">브리핑 데이터를 불러오는 중...</p>';
  panel.classList.add("visible");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });

  const [t1, t2] = [teamA, teamB].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const filename = `${t1}_vs_${t2}.json`;

  try {
    const h2h = await fetch(`data/h2h/${encodeURIComponent(filename)}`).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    renderBriefingPanel(teamA, teamB, h2h);
  } catch (e) {
    panel.innerHTML = `<p class="error-msg">맞대결 데이터를 찾을 수 없습니다.<br><small>${escHtml(filename)}</small></p>`;
  }
}

function renderBriefingPanel(teamA, teamB, h2hData) {
  const panel  = document.getElementById("briefing-panel");
  const colorA = getTeamColor(teamA);
  const colorB = getTeamColor(teamB);

  const getStandingInfo = (name) => {
    const row = getStandingRow(name);
    return row ? `${row[0]}위 ${row[3] || ""}` : "";
  };

  let html = `<div class="card">
    <div class="matchup-header">
      <div class="team-block">
        <div class="team-color-bar" style="background:${colorA}"></div>
        <div class="team-name-big" style="color:${colorA}">${escHtml(teamA)}</div>
        <div class="team-stat-line">${escHtml(getStandingInfo(teamA))}</div>
      </div>
      <div class="vs-big">VS</div>
      <div class="team-block">
        <div class="team-color-bar" style="background:${colorB}"></div>
        <div class="team-name-big" style="color:${colorB}">${escHtml(teamB)}</div>
        <div class="team-stat-line">${escHtml(getStandingInfo(teamB))}</div>
      </div>
    </div>`;

  const seasonH2H  = h2hData.season_h2h  || {};
  const allTimeH2H = h2hData.all_time_h2h || {};

  html += `<div class="h2h-summary">
    <div class="h2h-stat-card">
      <div class="h2h-stat-label">시즌 상대전적</div>
      <div class="h2h-stat-value">
        <span style="color:${colorA}">${escHtml(seasonH2H[teamA] || "-")}</span>&nbsp;/&nbsp;
        <span style="color:${colorB}">${escHtml(seasonH2H[teamB] || "-")}</span>
      </div>
    </div>
    <div class="h2h-stat-card">
      <div class="h2h-stat-label">통산 상대전적</div>
      <div class="h2h-stat-value">
        <span style="color:${colorA}">${escHtml(allTimeH2H[teamA] || "-")}</span>&nbsp;/&nbsp;
        <span style="color:${colorB}">${escHtml(allTimeH2H[teamB] || "-")}</span>
      </div>
    </div>
    <div class="h2h-stat-card">
      <div class="h2h-stat-label">총 맞대결 경기</div>
      <div class="h2h-stat-value">${(h2hData.games || []).length}경기</div>
    </div>
  </div>`;

  const scoreByGameNo = {};
  if (scheduleData) {
    scheduleData.games.forEach(sg => {
      if (sg.game_no && sg.home_score && sg.away_score) {
        scoreByGameNo[sg.game_no] = sg;
      }
    });
  }

  const games = h2hData.games || [];
  if (games.length) {
    html += `<h3 style="font-size:13px;color:var(--muted);margin-bottom:10px;">이번 시즌 맞대결 기록</h3>
      <div class="table-wrap"><table><thead><tr>
        <th>날짜</th><th>장소</th>
        <th style="color:${colorA}">${escHtml(teamA)}</th>
        <th>점수</th>
        <th style="color:${colorB}">${escHtml(teamB)}</th>
        <th>MVP</th>
      </tr></thead><tbody>`;

    games.slice().reverse().forEach(g => {
      const sc = scoreByGameNo[g.game_no];
      let scoreHtml = "-";
      let scoreA = "-", scoreB = "-";
      if (sc) {
        const isHomeA = normalizeTeam(sc.home_team) === normalizeTeam(teamA);
        scoreA = isHomeA ? sc.home_score : sc.away_score;
        scoreB = isHomeA ? sc.away_score : sc.home_score;
        const winA = parseInt(scoreA) > parseInt(scoreB);
        scoreHtml = `<span style="font-weight:700;color:${winA ? colorA : "var(--muted)"};">${escHtml(scoreA)}</span>`
                  + `<span style="color:var(--muted);margin:0 4px">:</span>`
                  + `<span style="font-weight:700;color:${!winA ? colorB : "var(--muted)"};">${escHtml(scoreB)}</span>`;
      }
      const venueTime = [g.time, g.venue].filter(Boolean).join(" ");
      html += `<tr>
        <td>${escHtml(formatDate(g.date))}</td>
        <td style="color:var(--muted);font-size:12px">${escHtml(venueTime || "-")}</td>
        <td style="color:${colorA};font-weight:600">${sc ? (parseInt(scoreA) > parseInt(scoreB) ? "승" : "패") : "-"}</td>
        <td>${scoreHtml}</td>
        <td style="color:${colorB};font-weight:600">${sc ? (parseInt(scoreB) > parseInt(scoreA) ? "승" : "패") : "-"}</td>
        <td style="font-size:12px">${escHtml(g.mvp || "-")}</td>
      </tr>`;
    });
    html += "</tbody></table></div>";
  }

  html += `<div class="briefing-grid" style="margin-top:20px;">`;
  if (playerRecordsData && playerRecordsData["득점"]) {
    const { headers, rows } = playerRecordsData["득점"];
    const avgIdx = headers.indexOf("평균득점");

    const renderMiniTable = (teamName, color) => {
      const canon = normalizeTeam(teamName);
      const teamRows = rows.filter(r => normalizeTeam(r[2]) === canon);
      if (!teamRows.length) {
        return `<div class="h2h-stat-card"><div class="h2h-stat-label" style="color:${color}">${escHtml(teamName)} 득점</div><p style="color:var(--muted);font-size:12px;margin-top:8px">데이터 없음</p></div>`;
      }
      let t = `<div class="h2h-stat-card">
        <div class="h2h-stat-label" style="color:${color};font-size:13px;margin-bottom:8px;">${escHtml(teamName)} 득점 순위</div>
        <div class="table-wrap"><table><thead><tr><th>순위</th><th>선수</th><th>평균</th></tr></thead><tbody>`;
      teamRows.slice(0, 5).forEach(r => {
        t += `<tr><td>${escHtml(r[0])}</td><td>${escHtml(r[1])}</td><td>${escHtml(avgIdx >= 0 ? r[avgIdx] : "-")}</td></tr>`;
      });
      t += "</tbody></table></div></div>";
      return t;
    };

    html += renderMiniTable(teamA, colorA);
    html += renderMiniTable(teamB, colorB);
  }
  html += "</div></div>";

  panel.innerHTML = html;
  highlightTeamRows(document.getElementById("standings-table"), teamA, teamB, colorA, colorB);
}

function highlightTeamRows(tableEl, teamA, teamB, colorA, colorB) {
  if (!tableEl) return;
  tableEl.querySelectorAll("tr[data-team]").forEach(tr => { tr.style.background = ""; });
  tableEl.querySelectorAll(`tr[data-team="${CSS.escape(normalizeTeam(teamA))}"]`)
    .forEach(tr => { tr.style.background = `${colorA}22`; });
  tableEl.querySelectorAll(`tr[data-team="${CSS.escape(normalizeTeam(teamB))}"]`)
    .forEach(tr => { tr.style.background = `${colorB}22`; });
}

// ─── URL 해시 라우팅 ───────────────────────────────────────────────────────────
function handleHashChange() {
  const hash = decodeURIComponent(window.location.hash.slice(1));
  if (!hash.includes("-vs-")) return;
  const [teamA, teamB] = hash.split("-vs-");
  if (!teamA || !teamB) return;
  const selA = document.getElementById("select-team-a");
  const selB = document.getElementById("select-team-b");
  if (selA && selB) {
    selA.value = teamA;
    selB.value = teamB;
    updateBriefingButton();
    showBriefing(teamA, teamB);
  }
}

function setHashFromSelection() {
  const a = document.getElementById("select-team-a").value;
  const b = document.getElementById("select-team-b").value;
  if (a && b && a !== b) {
    window.location.hash = encodeURIComponent(`${a}-vs-${b}`);
  }
}

// ─── 초기화 ───────────────────────────────────────────────────────────────────
async function init() {
  document.getElementById("select-team-a").addEventListener("change", updateBriefingButton);
  document.getElementById("select-team-b").addEventListener("change", updateBriefingButton);
  document.getElementById("btn-briefing").addEventListener("click", () => {
    const a = document.getElementById("select-team-a").value;
    const b = document.getElementById("select-team-b").value;
    if (a && b && a !== b) { setHashFromSelection(); showBriefing(a, b); }
  });
  window.addEventListener("hashchange", handleHashChange);

  // 모달 닫기 이벤트
  document.getElementById("modal-close-btn").addEventListener("click", closeGameModal);
  document.getElementById("game-modal").addEventListener("click", e => {
    if (e.target === e.currentTarget) closeGameModal();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeGameModal();
  });

  await loadMeta();
  await loadStandings();
  await loadSchedule();
  await loadPlayerRecords();

  if (window.location.hash) handleHashChange();
}

document.addEventListener("DOMContentLoaded", init);
