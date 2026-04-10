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

      const displayName = athlete.displayName || '';
      const nameParts = displayName.trim().split(' ');
      const lastName = athlete.lastName || (nameParts.length > 1 ? nameParts[nameParts.length - 1] : displayName);
      const firstName = athlete.firstName || (nameParts.length > 1 ? nameParts[0] : '');

      // SCORE — cumulative to-par, ESPN sends as "-14", "E", "+3"
      const scoreStr = comp.score || 'E';
      const totalToPar = scoreStr === 'E' ? 0 : (parseInt(scoreStr) || 0);

      // TODAY — current round to-par
      const todayStr = comp.today || 'E';
      const todayScore = todayStr === 'E' ? 0 : (parseInt(todayStr) || 0);

      // STATUS
      const playerStatus = (comp.status && comp.status.type && comp.status.type.shortDetail) || '';
      const statusLower = playerStatus.toLowerCase();
      const isCut = statusLower.includes('cut') || statusLower.includes('mc');
      const isWD  = statusLower.includes('wd') || statusLower.includes('withdrew') || statusLower.includes('withdrawal');
      const isDQ  = statusLower.includes('dq') || statusLower.includes('disqualified');
      const isActive = !isCut && !isWD && !isDQ;

      // THRU — hole number in progress, "F" if finished, or tee time
      // ESPN puts this in comp.status.type.shortDetail or comp.linescores
      let thru = '-';
      const shortDetail = (comp.status && comp.status.type && comp.status.type.shortDetail) || '';
      if (isActive) {
        if (shortDetail === 'F' || shortDetail === 'F*') {
          thru = 'F';
        } else {
          // shortDetail often contains "Thru 7" or just "7" or a tee time like "8:48 AM"
          const holeMatch = shortDetail.match(/(\d{1,2})$/);
          if (holeMatch) {
            thru = holeMatch[1] === '18' ? 'F' : holeMatch[1];
          } else if (shortDetail.match(/\d{1,2}:\d{2}/)) {
            // It's a tee time — convert from ET to BST (ET + 5 hours)
            const timeMatch = shortDetail.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
            if (timeMatch) {
              let h = parseInt(timeMatch[1]);
              const m = timeMatch[2];
              const ampm = timeMatch[3].toUpperCase();
              if (ampm === 'PM' && h !== 12) h += 12;
              if (ampm === 'AM' && h === 12) h = 0;
              h += 5; // ET to BST
              if (h >= 24) h -= 24;
              thru = h + ':' + m + ' BST';
            } else {
              thru = shortDetail; // fallback: show as-is
            }
          } else if (shortDetail) {
            thru = shortDetail;
          }
        }
      }

      // ROUND SCORES — linescores[] from ESPN contains raw strokes per completed round
      // e.g. [{value:"70"}, {value:"68"}] = R1 70 strokes, R2 68 strokes
      // Convert: to-par = strokes - 72
      const roundScores = [null, null, null, null];
      const linescores = comp.linescores || [];

      if (currentRound === 1) {
        // R1 in progress — no completed linescores yet, today IS R1
        roundScores[0] = todayScore;
      } else {
        // R2+: linescores has one entry per completed round
        // For a cut player after R2: linescores has 2 entries (R1, R2)
        // For active R2 player: linescores has 1 entry (R1 complete), R2 = today
        const completedRounds = isCut ? linescores.length : currentRound - 1;

        for (let i = 0; i < completedRounds && i < linescores.length; i++) {
          const val = linescores[i] && linescores[i].value;
          const strokes = parseInt(val);
          if (!isNaN(strokes)) {
            // Raw strokes (e.g. 70) → convert to to-par. To-par values are always small (-10 to +10 range)
            roundScores[i] = strokes > 30 ? strokes - COURSE_PAR : strokes;
          }
        }

        // Active player: current round = todayScore
        if (isActive) {
          roundScores[currentRound - 1] = todayScore;
        }
      }

      return {
        name: displayName,
        lastName: lastName,
        firstName: firstName,
        totalToPar: totalToPar,
        todayScore: isCut ? null : todayScore,
        thru: thru,
        r1: roundScores[0],
        r2: roundScores[1],
        r3: roundScores[2],
        r4: roundScores[3],
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
