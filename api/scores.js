// Scores paused — The Open 2026 complete. Full 2026 Major season finished.
// Auto-refresh disabled so final scores are preserved.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).json({
    players: [],
    tournamentStatus: 'Complete',
    round: 4,
    paused: true,
    message: 'The Open 2026 complete. 2026 Major season finished.',
    lastUpdated: new Date().toISOString()
  });
};
