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

      // totalToPar — the only number we fully trust from ESPN, already relative to par
      const scoreStr = comp.score || 'E';
      const totalToPar = scoreStr === 'E' ? 0 : (parseInt(scoreStr) || 0);

      // todayScore — ESPN's "today" field, relative to par for current round
      const todayStr = comp.today || 'E';
      const todayScore = todayStr === 'E' ? 0 : (parseInt(todayStr) || 0);

      // thru — how many holes completed today
      const thru = comp.thru || '-';

      // Build per-round scores — all relative to par
      // During Round 1: R1 = totalToPar (they are the same thing)
      // During Round 2: R1 = totalToPar - todayScore, R2 = todayScore
      // During Round 3: R1+R2 already final, R3 = todayScore
      // During Round 4: R1+R2+R3 already final, R4 = todayScore
      const roundScores = [null, null, null, null];

      if (currentRound === 1) {
        // R1 in progress — score = today = totalToPar
        roundScores[0] = totalToPar;
      } else {
        // For completed rounds, derive from linescores (raw strokes - 72)
        const linescores = comp.linescores || [];
        for (let i = 0; i < currentRound - 1 && i < linescores.length; i++) {
          const strokes = parseInt(linescores[i].value);
          if (!isNaN(strokes) && strokes > 50) {
            roundScores[i] = strokes - 72; // raw strokes to par
          } else if (!isNaN(strokes)) {
            roundScores[i] = strokes; // already to par
          }
        }
        // Current round = todayScore
        roundScores[currentRound - 1] = todayScore;
      }

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
        todayScore: currentRound === 1 ? totalToPar : todayScore, // during R1, today = total
        thru: thru,
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
