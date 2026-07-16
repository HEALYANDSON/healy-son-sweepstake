module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const TOURNAMENT_ID = '401811957'; // The Open 2026 - Royal Birkdale
  const COURSE_PAR = 70; // Royal Birkdale

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?tournamentId=${TOURNAMENT_ID}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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

    function parseToPar(val) {
      if (val === null || val === undefined) return 0;
      if (typeof val === 'number') return val;
      const s = String(val).trim();
      if (!s || s === '-') return 0;
      if (s.toUpperCase() === 'E' || s.toUpperCase() === 'EVEN') return 0;
      const n = parseInt(s, 10);
      if (isNaN(n)) return 0;
      return n > 30 ? n - COURSE_PAR : n;
    }

    const leaderboard = competitors.map(function(comp) {
      const athlete = comp.athlete || {};
      const displayName = athlete.displayName || '';
      const nameParts = displayName.trim().split(' ');
      const lastName = athlete.lastName || (nameParts.length > 1 ? nameParts[nameParts.length - 1] : displayName);
      const firstName = athlete.firstName || (nameParts.length > 1 ? nameParts[0] : '');

      const totalToPar = parseToPar(comp.score);
      const todayToPar = parseToPar(comp.today);

      const statusType = (comp.status && comp.status.type) || {};
      const statusName = statusType.name || '';
      const statusDetail = statusType.shortDetail || statusType.description || '';
      const allStatus = (statusName + ' ' + statusDetail).toLowerCase();

      const isCut = statusName === 'STATUS_MISSED_CUT' || allStatus.includes('cut') || allStatus.includes(' mc');
      const isWD  = statusName === 'STATUS_WITHDRAWN' || allStatus.includes('wd') || allStatus.includes('withdrew');
      const isDQ  = statusName === 'STATUS_DISQUALIFIED' || allStatus.includes('dq');

      let position = '-';
      if (comp.position) position = comp.position.displayName || comp.position.name || String(comp.position);

      let thru = '-';
      if (!isCut && !isWD && !isDQ) {
        if (comp.thru !== undefined && comp.thru !== null && String(comp.thru).trim() !== '') {
          thru = String(comp.thru) === '18' ? 'F' : String(comp.thru);
        } else if (statusDetail) {
          if (/^f$/i.test(statusDetail.trim())) thru = 'F';
          else { const m = statusDetail.match(/(\d+)/); if (m) thru = m[1] === '18' ? 'F' : m[1]; }
        }
      }

      return {
        name: displayName,
        lastName: lastName,
        firstName: firstName,
        position: position,
        totalToPar: totalToPar,
        todayScore: (!isCut && !isWD && !isDQ) ? todayToPar : null,
        thru: thru,
        rounds: [null, null, null, null],
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
