import trendsHandler from '../../lib/oura/trends.js';
import sleepScoreHandler from '../../lib/oura/sleep-score.js';
import keyStatusHandler from '../../lib/oura/key.js';

export default async function handler(req, res) {
  const action = String(req.query?.action || '').trim().toLowerCase();

  if (!action || action === 'trends' || action === 'data') {
    return trendsHandler(req, res);
  }

  if (action === 'sleep-score' || action === 'sleep_score' || action === 'sleep') {
    return sleepScoreHandler(req, res);
  }

  if (action === 'key-status' || action === 'key_status' || action === 'key') {
    return keyStatusHandler(req, res);
  }

  return res.status(400).json({
    ok: false,
    error: 'Unknown Oura action. Use trends, sleep-score, or key-status.',
  });
}
