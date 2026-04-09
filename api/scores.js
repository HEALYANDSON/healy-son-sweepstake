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

      // totalToPar
      const scoreStr = comp.score || 'E';
      const totalToPar = scoreStr === 'E' ? 0 : (parseInt(scoreStr) || 0);

      // todayScore
      const todayStr = comp.today || 'E';
      const todayScore = todayStr === 'E' ? 0 : (parseInt(todayStr) || 0);

      // Position — try multiple ESPN field locations
      const posDisplay =
        (comp.status && comp.status.position && comp.status.position.displayName) ||
        (comp.status && comp.status.position && comp.status.position.name) ||
        (comp.sortOrder ? 'T' + comp.sortOrder : '-');

      // Thru — try multiple field names ESPN uses
      const thruRaw = comp.thru !== undefined ? comp.thru : (comp.holesPlayed !== undefined ? comp.holesPlayed : null);
      const thru = thruRaw !== null && thruRaw !== undefined && thruRaw !== '' ? String(thruRaw) : '-';

      // Build per-round scores
      const roundScores = [null, null, null, null];

      if (currentRound === 1) {
        roundScores[0] = totalToPar;
      } else {
        const linescores = comp.linescores || [];
        for (let i = 0; i < currentRound - 1 && i < linescores.length; i++) {
          const strokes = parseInt(linescores[i].value);
          if (!isNaN(strokes) && strokes > 50) {
            roundScores[i] = strokes - 72;
          } else if (!isNaN(strokes)) {
            roundScores[i] = strokes;
          }
        }
        roundScores[currentRound - 1] = todayScore;
      }

      const playerStatus = (comp.status && comp.status.type && comp.status.type.shortDetail) || '';
      const isCut = playerStatus.toLowerCase().includes('cut');
      const isWD = playerStatus.toLowerCase().includes('wd') || playerStatus.toLowerCase().includes('withdrew');
      const isDQ = playerStatus.toLowerCase().includes('dq');

      // Also dump raw comp fields we might need for debugging
      return {
        name: athlete.displayName || '',
        lastName: athlete.lastName || '',
        firstName: athlete.firstName || '',
        position: posDisplay,
        totalToPar: totalToPar,
        todayScore: currentRound === 1 ? totalToPar : todayScore,
        thru: thru,
        rounds: roundScores,
        status: isCut ? 'CUT' : isWD ? 'WD' : isDQ ? 'DQ' : '',
        sortOrder: comp.sortOrder || 999,
        // Debug: expose raw ESPN fields so we can see what's available
        _raw: {
          thru: comp.thru,
          holesPlayed: comp.holesPlayed,
          status: comp.status,
          sortOrder: comp.sortOrder
        }
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
