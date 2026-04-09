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
    const round = (events.status && events.status.period) || 1;

    const leaderboard = competitors.map(function(comp) {
      const athlete = comp.athlete || {};

      // These come from ESPN already relative to par — trust them completely
      const scoreStr = comp.score || 'E';
      const totalToPar = scoreStr === 'E' ? 0 : (parseInt(scoreStr) || 0);

      const todayStr = comp.today || 'E';
      const todayScore = todayStr === 'E' ? 0 : (parseInt(todayStr) || 0);

      // Derive per-round to-par by diffing the cumulative total
      // totalToPar = R1 + R2 + R3 + R4 (completed rounds) + today (in progress)
      // So previous rounds = totalToPar - todayScore
      // For multiple completed rounds we split evenly (best we can without hole data)
      // But actually: completed round scores are in linescores as strokes
      // We use: completedRoundPar = totalToPar - todayScore, spread across completed rounds
      const linescores = comp.linescores || [];
      const completedRounds = round > 1 ? round - 1 : 0;
      const completedTotalToPar = totalToPar - todayScore;

      // Build round scores array - all relative to par
      const roundScores = [null, null, null, null];

      if (completedRounds >= 1 && linescores.length >= 1) {
        // We know total of all completed rounds = completedTotalToPar
        // Get individual round strokes from linescores and convert each
        // Par per completed round = 72 (Augusta full round)
        for (let i = 0; i < completedRounds && i < linescores.length; i++) {
          const strokes = parseInt(linescores[i].value);
          if (!isNaN(strokes) && strokes > 20) {
            // Raw strokes — convert to par
            roundScores[i] = strokes - 72;
          } else if (!isNaN(strokes)) {
            // Already to-par somehow
            roundScores[i] = strokes;
          }
        }
      }

      // Current round = todayScore (already to-par from ESPN)
      if (round >= 1) {
        roundScores[round - 1] = todayScore;
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
        todayScore: todayScore,
        thru: comp.thru || (isCut ? 'F' : '-'),
        rounds: roundScores,
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
    return res.status(500).json({ error: err.message, players: [], status: 'error' });
  }
};
