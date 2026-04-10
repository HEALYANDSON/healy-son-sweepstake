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
    const events = data && data.events && data.events[0];
    if (!events) return res.status(200).json({ players: [], status: 'no_data' });

    const competition = events.competitions && events.competitions[0];
    const competitors = (competition && competition.competitors) || [];
    const status = (events.status && events.status.type && events.status.type.description) || 'In Progress';
    const currentRound = (events.status && events.status.period) || 1;

    const leaderboard = competitors.map(function(comp) {
      const athlete = comp.athlete || {};

      // Extract last name from displayName as fallback (ESPN often leaves lastName blank)
      const displayName = athlete.displayName || '';
      const nameParts = displayName.trim().split(' ');
      const lastName = athlete.lastName || (nameParts.length > 1 ? nameParts[nameParts.length - 1] : displayName);
      const firstName = athlete.firstName || (nameParts.length > 1 ? nameParts[0] : '');

      // totalToPar — cumulative, already relative to par
      const scoreStr = comp.score || 'E';
      const totalToPar = scoreStr === 'E' ? 0 : (parseInt(scoreStr) || 0);

      // todayScore — current round relative to par
      const todayStr = comp.today || 'E';
      const todayScore = todayStr === 'E' ? 0 : (parseInt(todayStr) || 0);

      // Player status
      const playerStatus = (comp.status && comp.status.type && comp.status.type.shortDetail) || '';
      const statusLower = playerStatus.toLowerCase();
      const isCut = statusLower.includes('cut') || statusLower.includes('mc');
      const isWD = statusLower.includes('wd') || statusLower.includes('withdrew') || statusLower.includes('withdrawal');
      const isDQ = statusLower.includes('dq') || statusLower.includes('disqualified');
      const isActive = !isCut && !isWD && !isDQ;

      // Build per-round scores — all relative to par
      const roundScores = [null, null, null, null];
      const linescores = comp.linescores || [];

      if (currentRound === 1) {
        // R1 in progress: score = today = totalToPar
        roundScores[0] = totalToPar;
      } else {
        // Completed rounds: derive from linescores (raw strokes → subtract par)
        // linescores array contains one entry per completed round
        const completedRounds = isCut ? linescores.length : currentRound - 1;
        for (let i = 0; i < completedRounds && i < linescores.length; i++) {
          const val = linescores[i].value;
          const strokes = parseInt(val);
          if (!isNaN(strokes)) {
            // If value > 50 it's raw strokes, convert to par
            roundScores[i] = strokes > 50 ? strokes - COURSE_PAR : strokes;
          }
        }
        // Current round for active players
        if (isActive && currentRound <= 4) {
          roundScores[currentRound - 1] = todayScore;
        }
      }

      return {
        name: displayName,
        lastName: lastName,
        firstName: firstName,
        totalToPar: totalToPar,
        // For cut players today resets to 0 — use totalToPar as today for display clarity
        todayScore: currentRound === 1 ? totalToPar : (isCut ? null : todayScore),
        rounds: roundScores,
        status: isCut ? 'CUT' : isWD ? 'WD' : isDQ ? 'DQ' : '',
        sortOrder: comp.sortOrder || 999
      };
    });

    leaderboard.sort(function(a, b) { return a.sortOrder - b.sortOrder; });

    return res.status(200).json({
      players: leaderboard,
      tournamentStatus: status,
      round: currentRound,
      lastUpdated: new Date().toISOString()
    });

  } catch (err) {
    console.error('ESPN fetch error:', err);
    return res.status(500).json({ error: err.message, players: [], status: 'error' });
  }
};
