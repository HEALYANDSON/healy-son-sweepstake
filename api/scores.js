export default async function handler(req, res) {
  // Allow CORS from your own app
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const TOURNAMENT_ID = '401811941'; // Masters 2026

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?tournamentId=${TOURNAMENT_ID}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; sweepstake-app/1.0)',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`ESPN returned ${response.status}`);
    }

    const data = await response.json();

    // Parse into a clean format the app can use
    const leaderboard = [];

    const events = data?.events?.[0];
    if (!events) {
      return res.status(200).json({ players: [], status: 'no_data', raw: data });
    }

    const competition = events.competitions?.[0];
    const competitors = competition?.competitors || [];
    const status = events.status?.type?.description || 'Unknown';
    const round = events.status?.period || 1;
    const cutLine = competition?.situation?.cutLine?.score || null;

    competitors.forEach(comp => {
      const athlete = comp.athlete;
      const stats = comp.statistics || [];
      const linescores = comp.linescores || [];

      // Extract round scores
      const rounds = linescores.map(ls => {
        const val = ls.value;
        return val === undefined || val === null || isNaN(val) ? null : parseInt(val);
      });

      // Total to par
      const scoreStr = comp.score || 'E';
      let totalToPar = 0;
      if (scoreStr === 'E') totalToPar = 0;
      else totalToPar = parseInt(scoreStr) || 0;

      // Today's score
      const todayStr = comp.today || 'E';
      let todayScore = 0;
      if (todayStr === 'E') todayScore = 0;
      else todayScore = parseInt(todayStr) || 0;

      const playerStatus = comp.status?.type?.shortDetail || '';
      const isCut = playerStatus.toLowerCase().includes('cut');
      const isWD = playerStatus.toLowerCase().includes('wd') || playerStatus.toLowerCase().includes('withdrew');
      const isDQ = playerStatus.toLowerCase().includes('dq') || playerStatus.toLowerCase().includes('disqualified');

      leaderboard.push({
        id: athlete?.id,
        name: athlete?.displayName || '',
        lastName: athlete?.lastName || '',
        firstName: athlete?.firstName || '',
        position: comp.status?.position?.displayName || comp.sortOrder || '',
        totalToPar,
        todayScore,
        thru: comp.thru || (isCut ? 'F' : '-'),
        rounds,
        status: isCut ? 'CUT' : isWD ? 'WD' : isDQ ? 'DQ' : '',
        sortOrder: comp.sortOrder || 999
      });
    });

    // Sort by sort order
    leaderboard.sort((a, b) => a.sortOrder - b.sortOrder);

    return res.status(200).json({
      players: leaderboard,
      tournamentStatus: status,
      round,
      cutLine,
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
}
