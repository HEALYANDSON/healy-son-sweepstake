module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const TOURNAMENT_ID = '401811941'; // Masters 2026

  try {
    const url = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?tournamentId=' + TOURNAMENT_ID;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; sweepstake-app/1.0)',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error('ESPN returned ' + response.status);
    }

    const data = await response.json();

    const events = data && data.events && data.events[0];
    if (!events) {
      return res.status(200).json({ players: [], status: 'no_data' });
    }

    const competition = events.competitions && events.competitions[0];
    const competitors = (competition && competition.competitors) || [];
    const status = (events.status && events.status.type && events.status.type.description) || 'In Progress';
    const round = (events.status && events.status.period) || 1;

    const leaderboard = competitors.map(function(comp) {
      const athlete = comp.athlete || {};
      const linescores = comp.linescores || [];

      // totalToPar and todayScore come from ESPN already relative to par
      const scoreStr = comp.score || 'E';
      const totalToPar = scoreStr === 'E' ? 0 : (parseInt(scoreStr) || 0);

      const todayStr = comp.today || 'E';
      const todayScore = todayStr === 'E' ? 0 : (parseInt(todayStr) || 0);

      // Build per-round to-par scores by diffing cumulative totals
      // linescores[i].value is raw strokes — but we can derive to-par per round
      // from the cumulative total and today's score:
      // e.g. after R2: totalToPar = R1_par + R2_par
      // so R1_par = totalToPar - todayScore (if currently in R2)
      // For completed rounds, ESPN linescores also contain a toPar field
      const roundScores = linescores.map(function(ls) {
        // Try toPar field first (most reliable)
        if (ls.toPar !== undefined && ls.toPar !== null) {
          return ls.toPar === 'E' ? 0 : parseInt(ls.toPar) || 0;
        }
        // Fall back: raw strokes - par (Augusta = 72)
        const val = ls.value;
        if (val === undefined || val === null || isNaN(val)) return null;
        const strokes = parseInt(val);
        // If it looks like it's already to-par (small number), use it directly
        if (Math.abs(strokes) <= 15) return strokes;
        return strokes - 72;
      });

      const playerStatus = (comp.status && comp.status.type && comp.status.type.shortDetail) || '';
      const isCut = playerStatus.toLowerCase().includes('cut');
      const isWD = playerStatus.toLowerCase().includes('wd') || playerStatus.toLowerCase().includes('withdrew');
      const isDQ = playerStatus.toLowerCase().includes('dq');

      return {
        name: athlete.displayName || '',
        lastName: athlete.lastName || '',
        firstName: athlete.firstName || '',
        position: (comp.status && comp.status.position && comp.status.position.displayName) || String(comp.sortOrder || ''),
        totalToPar: totalToPar,
        todayScore: todayScore,
        thru: comp.thru || (isCut ? 'F' : '-'),
        rounds: roundScores,  // now all relative to par
        status: isCut ? 'CUT' : isWD ? 'WD' : isDQ ? 'DQ' : '',
        sortOrder: comp.sortOrder || 999
      };
    });

    leaderboard.sort(function(a, b) { return a.sortOrder - b.sortOrder; });

    return res.status(200).json({
      players: leaderboard,
      tournamentStatus: status,
      round: round,
      lastUpdated: new Date().toISOString()
    });

  } catch (err) {
    console.error('ESPN fetch error:', err);
    return res.status(500).json({
      error: err.message,
      players: [],
      status: 'error'
    });
  }
};
