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

// ─── 전역 캐시 ─────────────────────────────────────────────────────────────────
let standingsData    = null;
let scheduleData     = null;
let playerRecordsData = null;

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
function getTeamColor(teamName) {
  return TEAM_COLORS[teamName] || "#888";
}

function formatLast5Badges(str) {
  // "4-1" 형태 → W/L 뱃지 HTML (앞=승, 뒤=패)
  if (!str || !str.includes("-")) return `<span>${str || "-"}</span>`;
  const [wins, losses] = str.split("-").map(Number);
  const total = wins + losses;
  let html = '<span class="badge-wrap">';
  for (let i = 0; i < Math.min(wins, 5); i++)   html += '<span class="badge badge-w">W</span>';
  for (let i = 0; i < Math.min(losses, 5 - wins); i++) html += '<span class="badge badge-l">L</span>';
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
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
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
  const teams = new Set();
  if (standingsData && standingsData.rows) {
    standingsData.rows.forEach(row => { if (row[1]) teams.add(row[1]); });
  } else {
    (schedData.games || []).forEach(g => {
      if (g.home_team) teams.add(g.home_team);
      if (g.away_team) teams.add(g.away_team);
    });
  }

  const sorted = [...teams].sort((a, b) => a.localeCompare(b, "ko"));
  const selA = document.getElementById("select-team-a");
  const selB = document.getElementById("select-team-b");

  sorted.forEach(name => {
    const optA = new Option(name, name);
    const optB = new Option(name, name);
    selA.add(optA);
    selB.add(optB);
  });

  updateBriefingButton();
}

function updateBriefingButton() {
  const selA = document.getElementById("select-team-a");
  const selB = document.getElementById("select-team-b");
  const btn  = document.getElementById("btn-briefing");
  const a = selA.value, b = selB.value;
  btn.disabled = !a || !b || a === b;
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
    const teamName = row[1] || "";
    const color = getTeamColor(teamName);
    html += `<tr data-team="${escHtml(teamName)}">`;
    row.forEach((cell, idx) => {
      if (idx === 0) {
        html += `<td class="rank">${escHtml(cell)}</td>`;
      } else if (idx === 1) {
        html += `<td class="team-name" style="border-left: 3px solid ${color}">${escHtml(cell)}</td>`;
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

// ─── 일정 테이블 렌더 ──────────────────────────────────────────────────────────
function renderScheduleTable(data) {
  const container = document.getElementById("schedule-container");
  if (!data || !data.games || !data.games.length) {
    container.innerHTML = '<p class="error-msg">일정 데이터가 없습니다.</p>';
    return;
  }

  // 이번달 + 다음달만 표시
  const today = new Date();
  const thisMonth = today.getFullYear() * 100 + (today.getMonth() + 1);
  const nextMonth = thisMonth + 1;

  const filtered = data.games.filter(g => {
    if (!g.ym) return true;
    const ym = parseInt(g.ym);
    return ym === thisMonth || ym === nextMonth;
  });

  if (!filtered.length) {
    container.innerHTML = '<p class="loading">이번달/다음달 일정이 없습니다.</p>';
    return;
  }

  let html = '<div class="table-wrap"><table id="schedule-table"><thead><tr>'
    + "<th>날짜</th><th>시간</th><th>홈팀</th><th>VS</th><th>원정팀</th>"
    + "<th>장소</th><th>방송</th><th>결과</th>"
    + "</tr></thead><tbody>";

  filtered.forEach(g => {
    const done = g.is_completed;
    const homeColor = getTeamColor(g.home_team);
    const awayColor = getTeamColor(g.away_team);
    html += `<tr class="${done ? "completed" : ""}">`;
    html += `<td>${escHtml(formatDate(g.date))}</td>`;
    html += `<td>${escHtml(g.time || "-")}</td>`;
    html += `<td style="font-weight:600;border-left:3px solid ${homeColor}">${escHtml(g.home_team)}</td>`;
    html += `<td style="color:var(--muted)">VS</td>`;
    html += `<td style="font-weight:600;border-left:3px solid ${awayColor}">${escHtml(g.away_team)}</td>`;
    html += `<td>${escHtml(g.venue || "-")}</td>`;
    html += `<td>${escHtml(g.broadcast || "-")}</td>`;
    if (done && g.home_score && g.away_score) {
      html += `<td class="score-cell"><span style="color:${homeColor};font-weight:700">${escHtml(g.home_score)}</span><span style="color:var(--muted);margin:0 4px">:</span><span style="color:${awayColor};font-weight:700">${escHtml(g.away_score)}</span></td>`;
    } else {
      html += `<td class="game-no-link">${done ? "완료" : "예정"}</td>`;
    }
    html += "</tr>";
  });

  html += "</tbody></table></div>";
  container.innerHTML = html;
}

// ─── 브리핑 패널 ───────────────────────────────────────────────────────────────
async function showBriefing(teamA, teamB) {
  const panel = document.getElementById("briefing-panel");
  panel.classList.remove("visible");
  panel.innerHTML = '<p class="loading">브리핑 데이터를 불러오는 중...</p>';
  panel.classList.add("visible");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });

  // 가나다순 정렬로 파일명 결정
  // Python sorted()와 동일한 유니코드 코드포인트 순 정렬 (locale 사용 시 한글이 영문 앞에 와서 파일명 불일치)
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
  const panel = document.getElementById("briefing-panel");
  const colorA = getTeamColor(teamA);
  const colorB = getTeamColor(teamB);

  // 순위 정보 가져오기
  const getStandingInfo = (name) => {
    if (!standingsData) return "";
    const row = standingsData.rows.find(r => r[1] === name);
    if (!row) return "";
    return `${row[0]}위 ${row[3] || ""}`;
  };

  // 헤더
  let html = `
    <div class="card">
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
      </div>
  `;

  // 전적 요약
  const seasonH2H   = h2hData.season_h2h   || {};
  const allTimeH2H  = h2hData.all_time_h2h || {};

  html += `<div class="h2h-summary">
    <div class="h2h-stat-card">
      <div class="h2h-stat-label">시즌 상대전적</div>
      <div class="h2h-stat-value">
        <span style="color:${colorA}">${escHtml(seasonH2H[teamA] || "-")}</span>
        &nbsp;/&nbsp;
        <span style="color:${colorB}">${escHtml(seasonH2H[teamB] || "-")}</span>
      </div>
    </div>
    <div class="h2h-stat-card">
      <div class="h2h-stat-label">통산 상대전적</div>
      <div class="h2h-stat-value">
        <span style="color:${colorA}">${escHtml(allTimeH2H[teamA] || "-")}</span>
        &nbsp;/&nbsp;
        <span style="color:${colorB}">${escHtml(allTimeH2H[teamB] || "-")}</span>
      </div>
    </div>
    <div class="h2h-stat-card">
      <div class="h2h-stat-label">총 맞대결 경기</div>
      <div class="h2h-stat-value">${(h2hData.games || []).length}경기</div>
    </div>
  </div>`;

  // schedule.json에서 game_no로 실제 점수 조회
  const scoreByGameNo = {};
  if (scheduleData) {
    scheduleData.games.forEach(sg => {
      if (sg.game_no && sg.home_score && sg.away_score) {
        scoreByGameNo[sg.game_no] = { home_team: sg.home_team, home: sg.home_score, away: sg.away_score };
      }
    });
  }

  // 맞대결 경기 기록
  const games = h2hData.games || [];
  if (games.length) {
    html += `<h3 style="font-size:13px;color:var(--muted);margin-bottom:10px;">이번 시즌 맞대결 기록</h3>
      <div class="table-wrap"><table><thead><tr>
        <th>날짜</th><th>장소</th><th>${escHtml(teamA)}</th><th>점수</th><th>${escHtml(teamB)}</th><th>MVP</th>
      </tr></thead><tbody>`;

    games.slice().reverse().forEach(g => {
      const sc = scoreByGameNo[g.game_no];
      let scoreHtml = "-";
      let scoreA = "-", scoreB = "-";
      if (sc) {
        // home_team 기준으로 teamA/teamB 점수 배분
        const isHomeA = sc.home_team === teamA || (sc.home_team && teamA.startsWith(sc.home_team)) || (sc.home_team && sc.home_team.startsWith(teamA));
        scoreA = isHomeA ? sc.home : sc.away;
        scoreB = isHomeA ? sc.away : sc.home;
        const winA = parseInt(scoreA) > parseInt(scoreB);
        scoreHtml = `<span style="font-weight:700;color:${winA ? colorA : 'var(--muted)'};">${escHtml(scoreA)}</span>`
                  + `<span style="color:var(--muted);margin:0 4px">:</span>`
                  + `<span style="font-weight:700;color:${!winA ? colorB : 'var(--muted)'};">${escHtml(scoreB)}</span>`;
      }
      html += `<tr>
        <td>${escHtml(formatDate(g.date))}</td>
        <td>${escHtml(g.venue || "-")}</td>
        <td style="color:${colorA};font-weight:600">${sc ? (parseInt(scoreA) > parseInt(scoreB) ? "승" : "패") : "-"}</td>
        <td>${scoreHtml}</td>
        <td style="color:${colorB};font-weight:600">${sc ? (parseInt(scoreB) > parseInt(scoreA) ? "승" : "패") : "-"}</td>
        <td>${escHtml(g.mvp || "-")}</td>
      </tr>`;
    });

    html += "</tbody></table></div>";
  }

  // 순위 테이블 하이라이트 영역
  html += `<div class="briefing-grid" style="margin-top:20px;">`;

  // 선수 득점 순위 (두 팀 필터)
  if (playerRecordsData && playerRecordsData["득점"]) {
    const { headers, rows } = playerRecordsData["득점"];
    const teamARows = rows.filter(r => r[2] === teamA);
    const teamBRows = rows.filter(r => r[2] === teamB);

    const renderMiniTable = (teamName, teamRows, color) => {
      if (!teamRows.length) return `<div class="h2h-stat-card"><div class="h2h-stat-label" style="color:${color}">${escHtml(teamName)} 득점 순위</div><p style="color:var(--muted);font-size:12px;margin-top:8px">데이터 없음</p></div>`;
      let t = `<div class="h2h-stat-card">
        <div class="h2h-stat-label" style="color:${color};font-size:13px;margin-bottom:8px;">${escHtml(teamName)} 득점 순위</div>
        <div class="table-wrap"><table>
          <thead><tr><th>순위</th><th>선수</th><th>평균</th></tr></thead>
          <tbody>`;
      teamRows.slice(0, 5).forEach(r => {
        const avgIdx = headers.indexOf("평균득점");
        t += `<tr><td>${escHtml(r[0])}</td><td>${escHtml(r[1])}</td><td>${escHtml(avgIdx >= 0 ? r[avgIdx] : "-")}</td></tr>`;
      });
      t += "</tbody></table></div></div>";
      return t;
    };

    html += renderMiniTable(teamA, teamARows, colorA);
    html += renderMiniTable(teamB, teamBRows, colorB);
  }

  html += "</div></div>";

  panel.innerHTML = html;

  // 순위 테이블에서 선택된 팀 행 강조
  highlightTeamRows(document.getElementById("standings-table"), teamA, teamB, colorA, colorB);
}

function highlightTeamRows(tableEl, teamA, teamB, colorA, colorB) {
  if (!tableEl) return;
  tableEl.querySelectorAll("tr[data-team]").forEach(tr => {
    tr.classList.remove("highlight-a", "highlight-b");
    tr.style.removeProperty("--highlight-a");
    tr.style.removeProperty("--highlight-b");
    tr.style.background = "";
  });
  tableEl.querySelectorAll(`tr[data-team="${CSS.escape(teamA)}"]`).forEach(tr => {
    tr.style.background = `${colorA}22`;
  });
  tableEl.querySelectorAll(`tr[data-team="${CSS.escape(teamB)}"]`).forEach(tr => {
    tr.style.background = `${colorB}22`;
  });
}

// ─── URL 해시 라우팅 ───────────────────────────────────────────────────────────
function handleHashChange() {
  const hash = decodeURIComponent(window.location.hash.slice(1)); // #팀A-vs-팀B
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
  // 이벤트 바인딩
  document.getElementById("select-team-a").addEventListener("change", updateBriefingButton);
  document.getElementById("select-team-b").addEventListener("change", updateBriefingButton);
  document.getElementById("btn-briefing").addEventListener("click", () => {
    const a = document.getElementById("select-team-a").value;
    const b = document.getElementById("select-team-b").value;
    if (a && b && a !== b) {
      setHashFromSelection();
      showBriefing(a, b);
    }
  });
  window.addEventListener("hashchange", handleHashChange);

  // 데이터 로드
  await loadMeta();
  await loadStandings();
  await loadSchedule();
  await loadPlayerRecords();

  // 초기 해시 처리
  if (window.location.hash) {
    handleHashChange();
  }
}

document.addEventListener("DOMContentLoaded", init);
