module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const TOURNAMENT_ID = '401811941';
  const COURSE_PAR = 72;

  try {
    const url = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?tournamentId=' + TOURNAMENT_ID;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error('ESPN returned ' + response.status);

    const raw = await response.json();
    const event = raw && raw.events && raw.events[0];
    if (!event) return res.status(200).json({ players: [], status: 'no_data' });

    const competition = event.competitions && event.competitions[0];
    const competitors = (competition && competition.competitors) || [];
    const statusDesc = (event.status && event.status.type && event.status.type.description) || 'In Progress';
    const currentRound = (event.status && event.status.period) || 1;

    function parseToPar(val) {
      if (val === null || val === undefined) return null;
      const s = String(val).trim();
      if (s === '' || s === '-') return null;
      if (s.toUpperCase() === 'E') return 0;
      const n = parseInt(s, 10);
      if (isNaN(n)) return null;
      return n > 40 ? n - COURSE_PAR : n;
    }

    const leaderboard = competitors.map(function(comp) {
      const athlete = comp.athlete || {};
      const displayName = athlete.displayName || '';
      const nameParts = displayName.trim().split(' ');
      const lastName = athlete.lastName || (nameParts.length > 1 ? nameParts[nameParts.length - 1] : displayName);
      const firstName = athlete.firstName || (nameParts.length > 1 ? nameParts[0] : '');

      const statusType = (comp.status && comp.status.type) || {};
      const statusName = statusType.name || '';
      const statusDetail = statusType.shortDetail || statusType.description || '';
      const statusLower = (statusName + ' ' + statusDetail).toLowerCase();

      const isCut = statusName === 'STATUS_MISSED_CUT' || statusLower.includes('cut') || statusLower.includes(' mc');
      const isWD  = statusName === 'STATUS_WITHDRAWN' || statusLower.includes('wd') || statusLower.includes('withdrew');
      const isDQ  = statusName === 'STATUS_DISQUALIFIED' || statusLower.includes('dq');
      const isActive = !isCut && !isWD && !isDQ;

      const totalToPar = parseToPar(comp.score);
      const todayToPar = isActive ? parseToPar(comp.today) : null;

      // Thru
      let thru = '-';
      if (isActive) {
        if (comp.thru !== undefined && comp.thru !== null && String(comp.thru).trim() !== '') {
          thru = String(comp.thru) === '18' ? 'F' : String(comp.thru);
        } else if (statusDetail) {
          if (/^f$/i.test(statusDetail.trim())) thru = 'F';
          else { const m = statusDetail.match(/(\d+)/); if (m) thru = m[1] === '18' ? 'F' : m[1]; }
        }
      }

      // Position
      let position = '-';
      if (comp.position) position = comp.position.displayName || comp.position.name || String(comp.position);

      // Round scores
      const roundScores = [null, null, null, null];
      const linescores = comp.linescores || [];
      const completedRounds = isCut ? 2 : Math.max(0, currentRound - 1);

      for (let i = 0; i < completedRounds && i < linescores.length && i < 4; i++) {
        const v = linescores[i] && linescores[i].value;
        const p = parseToPar(v);
        if (p !== null) roundScores[i] = p;
      }

      // Always set current active round to todayToPar (even if 0 = E)
      if (isActive && currentRound >= 1 && currentRound <= 4) {
        roundScores[currentRound - 1] = todayToPar !== null ? todayToPar : 0;
      }

      // Derive R1 if missing in R2
      if (currentRound === 2 && roundScores[0] === null && isActive && totalToPar !== null && todayToPar !== null) {
        roundScores[0] = totalToPar - todayToPar;
      }

      return {
        name: displayName,
        lastName: lastName,
        firstName: firstName,
        position: position,
        totalToPar: totalToPar !== null ? totalToPar : 0,
        todayScore: isActive ? (todayToPar !== null ? todayToPar : 0) : null,
        thru: thru,
        rounds: roundScores,
        status: isCut ? 'CUT' : isWD ? 'WD' : isDQ ? 'DQ' : '',
        sortOrder: comp.sortOrder || 9999
      };
    });

    leaderboard.sort(function(a, b) { return a.sortOrder - b.sortOrder; });

    return res.status(200).json({
      players: leaderboard,
      tournamentStatus: statusDesc,
      round: currentRound,
      lastUpdated: new Date().toISOString()
    });

  } catch (err) {
    console.error('ESPN fetch error:', err);
    return res.status(500).json({ error: err.message, players: [], status: 'error' });
  }
};
