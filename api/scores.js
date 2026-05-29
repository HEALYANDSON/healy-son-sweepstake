// Scores paused — PGA Championship 2026 is complete
// Auto-refresh disabled until next Major (US Open)
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).json({
    players: [],
    tournamentStatus: 'Complete',
    round: 4,
    paused: true,
    message: 'PGA Championship 2026 complete. Scoring paused until US Open.',
    lastUpdated: new Date().toISOString()
  });
};
