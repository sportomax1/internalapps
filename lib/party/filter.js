// api/party/filter.js — Profanity check endpoint
// POST { text: string } → { ok: true, blocked: boolean }
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Filter  = require('bad-words');
const filter  = new Filter();

// Extra patterns blocked beyond the word list
const EXTRA_PATTERNS = [
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,   // US phone numbers
  /\b\d{9,}\b/,                            // Long number strings (SSN-like)
  /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i,      // Email addresses
];

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { text } = req.body ?? {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ ok: false, error: 'Missing text' });
  }
  if (text.length > 200) {
    return res.status(400).json({ ok: false, error: 'Text too long' });
  }

  try {
    const hasProfanity = filter.isProfane(text);
    const hasExtraViolation = EXTRA_PATTERNS.some(re => re.test(text));
    return res.status(200).json({ ok: true, blocked: hasProfanity || hasExtraViolation });
  } catch {
    // If the filter throws (edge-case input), fail open — do not block.
    return res.status(200).json({ ok: true, blocked: false });
  }
}
