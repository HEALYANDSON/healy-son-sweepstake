module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const TOURNAMENT_ID = '401811941'; // Masters 2026
  const COURSE_PAR = 72;

  try {
    const url = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?tournamentId=' + TOURNAMENT_ID;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; sweepstake-app/1.0)',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) throw new Error('ESPN returned ' + response.status);

    const data = await response.json();
    const event = data && data.events && data.events[0];
    if (!event) return res.status(200).json({ players: [], status: 'no_data' });

    const competition = event.competitions && event.competitions[0];
    const competitors = (competition && competition.competitors) || [];
    const statusDesc = (event.status && event.status.type && event.status.type.description) || 'In Progress';
    const currentRound = (event.status && event.status.period) || 1;

    const leaderboard = competitors.map(function(comp) {
      const athlete = comp.athlete || {};

      // Name parsing
      const displayName = athlete.displayName || '';
      const nameParts = displayName.trim().split(' ');
      const lastName = athlete.lastName || (nameParts.length > 1 ? nameParts[nameParts.length - 1] : displayName);

      // ---- SCORE parsing ----
      // ESPN returns comp.score as the TOTAL cumulative to-par string e.g. "-14", "+3", "E"
      // comp.today is the CURRENT ROUND to-par string e.g. "-5", "+2", "E"
      const parseToPar = function(str) {
        if (str === null || str === undefined) return null;
        const s = String(str).trim();
        if (s === 'E' || s === '' || s === '-') return 0;
        const n = parseInt(s);
        return isNaN(n) ? 0 : n;
      };

      const totalToPar = parseToPar(comp.score);
      const todayToPar = parseToPar(comp.today);

      // ---- STATUS ----
      const statusDetail = (comp.status && comp.status.type && comp.status.type.shortDetail) || '';
      const statusLower = statusDetail.toLowerCase();
      const isCut = statusLower.includes('cut') || statusLower.includes('mc') ||
                    (comp.status && comp.status.type && comp.status.type.name === 'STATUS_MISSED_CUT');
      const isWD  = statusLower.includes('wd') || statusLower.includes('withdrew') || statusLower.includes('withdrawal');
      const isDQ  = statusLower.includes('dq') || statusLower.includes('disqualified');
      const isActive = !isCut && !isWD && !isDQ;

      // ---- THRU ----
      // comp.status.type.shortDetail often contains "F" (finished) or e.g. "Thru 9"
      // comp.thru is sometimes present directly
      let thru = '-';
      if (comp.thru !== undefined && comp.thru !== null) {
        thru = String(comp.thru);
      } else if (statusDetail) {
        if (statusDetail === 'F' || statusDetail.toLowerCase() === 'f') {
          thru = 'F';
        } else {
          const m = statusDetail.match(/thru\s+(\d+)/i) || statusDetail.match(/(\d+)/);
          if (m) thru = m[1];
        }
      }
      if (isCut || isWD || isDQ) thru = '-';

      // ---- POSITION ----
      const position = comp.position
        ? (comp.position.displayName || comp.position.name || String(comp.position))
        : (comp.sortOrder ? 'T' + comp.sortOrder : '-');

      // ---- ROUND SCORES ----
      // linescores[] contains one entry per round played.
      // Each entry has a value which may be raw strokes (e.g. 68) or to-par (e.g. -4).
      // We normalise to to-par.
      const roundScores = [null, null, null, null];
      const linescores = comp.linescores || [];

      // Helper: convert a linescore value to to-par
      const lineToToPar = function(val) {
        const n = parseInt(val);
        if (isNaN(n)) return null;
        // If it looks like raw strokes (> 50), subtract course par
        return n > 50 ? n - COURSE_PAR : n;
      };

      if (currentRound === 1) {
        // Only R1 in progress — today = total
        roundScores[0] = totalToPar;
      } else {
        // R2+ — fill completed rounds from linescores
        // For an active R2 player: linescores[0] = R1 (completed), linescores[1] may be partial R2
        const completedCount = isCut ? linescores.length : currentRound - 1;

        for (let i = 0; i < linescores.length && i < 4; i++) {
          const val = linescores[i] && (linescores[i].value !== undefined ? linescores[i].value : null);
          if (val !== null) {
            if (i < completedCount) {
              // Fully completed round
              roundScores[i] = lineToToPar(val);
            } else if (i === currentRound - 1 && isActive) {
              // Current round in progress — use todayToPar for accuracy
              roundScores[i] = todayToPar;
            }
          }
        }

        // Ensure current active round is always set to todayToPar
        if (isActive && currentRound >= 2) {
          roundScores[currentRound - 1] = todayToPar;
        }

        // Sanity check: if we only got R1 from linescores but we're in R2,
        // make sure R1 is set. Derive R1 = total - today if linescores didn't give it.
        if (currentRound === 2 && roundScores[0] === null && isActive) {
          roundScores[0] = totalToPar - todayToPar;
        }
      }

      return {
        name: displayName,
        lastName: lastName,
        firstName: athlete.firstName || (nameParts.length > 1 ? nameParts[0] : ''),
        position: position,
        totalToPar: totalToPar,
        todayScore: isCut ? null : (isDQ || isWD ? null : todayToPar),
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
