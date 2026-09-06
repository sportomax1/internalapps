import startHandler from '../lib/party/start.js';
import advanceHandler from '../lib/party/advance.js';
import filterHandler from '../lib/party/filter.js';

const handlers = {
  start: startHandler,
  advance: advanceHandler,
  filter: filterHandler,
};

export default async function handler(req, res) {
  const action = String(req.query?.action || req.body?.action || '').trim().toLowerCase();
  const target = handlers[action];

  if (!target) {
    res.setHeader('Allow', 'POST');
    return res.status(400).json({
      ok: false,
      error: 'Unknown Party action. Use start, advance, or filter.',
    });
  }

  return target(req, res);
}
