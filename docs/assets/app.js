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

function getRecentGames(teamName, n = 3) {
  if (!scheduleData) return [];
  const canon = normalizeTeam(teamName);
  return scheduleData.games
    .filter(g => g.is_completed &&
      (normalizeTeam(g.home_team) === canon || normalizeTeam(g.away_team) === canon))
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

  content.innerHTML = buildModalContent(game, h2hData);
}

function closeGameModal() {
  const modal = document.getElementById("game-modal");
  modal.setAttribute("hidden", "");
  document.body.style.overflow = "";
}

function buildModalContent(game, h2hData) {
  const homeTeam = game.home_team;
  const awayTeam = game.away_team;
  const colorH   = getTeamColor(homeTeam);
  const colorA   = getTeamColor(awayTeam);
  const done     = game.is_completed;

  const homeRow  = getStandingRow(homeTeam);
  const awayRow  = getStandingRow(awayTeam);

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

  // ── 상대전적 ──
  if (h2hData) {
    const seasonH2H  = h2hData.season_h2h  || {};
    const allTimeH2H = h2hData.all_time_h2h || {};

    html += `<div class="modal-section">
      <div class="modal-section-title">상대전적</div>
      <div class="modal-h2h-row">
        <div class="modal-h2h-item">
          <div class="mh-label">시즌 상대전적</div>
          <div class="mh-val">
            <span style="color:${colorH}">${escHtml(seasonH2H[homeTeam] || "-")}</span>
            <span style="color:var(--muted)"> / </span>
            <span style="color:${colorA}">${escHtml(seasonH2H[awayTeam] || "-")}</span>
          </div>
        </div>
        <div class="modal-h2h-item">
          <div class="mh-label">통산 상대전적</div>
          <div class="mh-val">
            <span style="color:${colorH}">${escHtml(allTimeH2H[homeTeam] || "-")}</span>
            <span style="color:var(--muted)"> / </span>
            <span style="color:${colorA}">${escHtml(allTimeH2H[awayTeam] || "-")}</span>
          </div>
        </div>
      </div>
    </div>`;

    // 이번 시즌 맞대결 기록
    const h2hGames = h2hData.games || [];
    if (h2hGames.length) {
      const scoreByGameNo = {};
      if (scheduleData) {
        scheduleData.games.forEach(sg => {
          if (sg.game_no && sg.home_score && sg.away_score) {
            scoreByGameNo[sg.game_no] = sg;
          }
        });
      }

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
          const isHomeH = normalizeTeam(sc.home_team) === normalizeTeam(homeTeam);
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

  // ── 최근 3경기 ──
  const homeRecent = getRecentGames(homeTeam, 3);
  const awayRecent = getRecentGames(awayTeam, 3);
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

  // ── 출처 ──
  html += `<div class="modal-source">
    출처: <a href="https://www.wkbl.or.kr" target="_blank" rel="noopener noreferrer">wkbl.or.kr</a>
  </div>`;

  return html;
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
