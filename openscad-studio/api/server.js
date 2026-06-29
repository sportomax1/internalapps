/**
 * OpenSCAD Studio — api/server.js
 *
 * Express backend that compiles OpenSCAD source code to binary STL.
 * Deployed on Render as a Docker Web Service.
 *
 * Endpoints:
 *   GET  /         → service info
 *   GET  /health   → { status: "ok" }
 *   POST /compile  { code: string } → binary STL (application/octet-stream)
 *
 * Stubbed future endpoints (return 501):
 *   POST /render-png
 *   POST /analyze
 *   POST /slice
 *   POST /estimate-print
 */

'use strict';

const express         = require('express');
const cors            = require('cors');
const { execFile }    = require('child_process');
const fs              = require('fs');
const path            = require('path');
const os              = require('os');
const { v4: uuidv4 }  = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Compile limits ────────────────────────────────────────────────
const MAX_CODE_BYTES    = 500_000;      // 500 KB source limit
const OPENSCAD_TIMEOUT  = 55_000;       // 55 s (leave headroom vs 60 s client)
const MIN_STL_BYTES     = 84;           // minimum valid binary STL (header + count)

// ── CORS ──────────────────────────────────────────────────────────
// Allow any origin so the GitHub Pages frontend can reach this API.
// Tighten to your specific Pages URL if you want stricter security:
//   origin: 'https://your-username.github.io'
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

// ── Body parsing ──────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// ── Health / info ─────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    service:   'OpenSCAD Studio API',
    version:   '1.0.0',
    endpoints: [
      'POST /compile',
      'GET  /health',
      'POST /render-png  (coming soon)',
      'POST /analyze     (coming soon)',
      'POST /slice       (coming soon)',
      'POST /estimate-print (coming soon)',
    ],
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'openscad-studio-api' });
});

// ── POST /compile ─────────────────────────────────────────────────
app.post('/compile', async (req, res) => {
  const { code } = req.body ?? {};

  // ── Input validation ──
  if (typeof code !== 'string' || code.trim().length === 0) {
    return res.status(400).json({
      error:  'Invalid request',
      errors: [{ type: 'ERROR', line: null, message: 'Missing or empty "code" field.' }],
    });
  }

  const codeBytes = Buffer.byteLength(code, 'utf8');
  if (codeBytes > MAX_CODE_BYTES) {
    return res.status(400).json({
      error:  'Payload too large',
      errors: [{ type: 'ERROR', line: null, message: `Code exceeds maximum allowed size (${MAX_CODE_BYTES / 1000} KB).` }],
    });
  }

  // ── Create isolated temp directory ──
  const tempDir    = path.join(os.tmpdir(), `openscad-${uuidv4()}`);
  const inputFile  = path.join(tempDir, 'input.scad');
  const outputFile = path.join(tempDir, 'output.stl');

  try {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(inputFile, code, 'utf8');

    // ── Compile ──
    const stlBuffer = await runOpenSCAD(inputFile, outputFile);

    // ── Return binary STL ──
    res.set({
      'Content-Type':        'application/octet-stream',
      'Content-Disposition': 'attachment; filename="output.stl"',
      'Content-Length':      stlBuffer.length,
    });
    res.send(stlBuffer);

  } catch (err) {
    // Parse OpenSCAD error output into structured errors
    const errors = parseOpenSCADErrors(err.stderr ?? err.message ?? '');
    console.error('[compile] failed:', err.message?.slice(0, 200));

    res.status(422).json({
      error:  'Compilation failed',
      errors,
      stderr: (err.stderr ?? '').slice(0, 4000), // cap stderr in response
    });

  } finally {
    // Always clean up temp files — do not await to avoid delaying response
    setImmediate(() => cleanup(tempDir));
  }
});

// ── Future endpoints (stubbed) ────────────────────────────────────
['render-png', 'analyze', 'slice', 'estimate-print'].forEach(ep => {
  app.post(`/${ep}`, (_req, res) =>
    res.status(501).json({ error: `/${ep} is not yet implemented.` })
  );
});

// ── 404 handler ───────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ═════════════════════════════════════════════════════════════════
// OpenSCAD runner
// ═════════════════════════════════════════════════════════════════

/**
 * Run OpenSCAD to compile input.scad → output.stl.
 *
 * On headless Linux (Render), OpenSCAD requires an X display for
 * geometry operations even when exporting STL.  We wrap it in
 * xvfb-run to provide a virtual framebuffer.
 *
 * Set environment variable USE_XVFB=false to skip xvfb-run
 * (e.g. if running locally on macOS/Windows).
 *
 * @param {string} inputFile   Absolute path to input.scad
 * @param {string} outputFile  Absolute path for output.stl
 * @returns {Promise<Buffer>}  STL file contents
 */
function runOpenSCAD(inputFile, outputFile) {
  return new Promise((resolve, reject) => {
    const useXvfb  = process.env.USE_XVFB !== 'false';
    const cmd      = useXvfb ? 'xvfb-run' : 'openscad';
    const args     = useXvfb
      ? ['-a', 'openscad', '-o', outputFile, inputFile]
      : ['-o', outputFile, inputFile];

    execFile(cmd, args, {
      timeout:   OPENSCAD_TIMEOUT,
      maxBuffer: 10 * 1024 * 1024, // 10 MB stderr/stdout buffer
    }, (err, _stdout, stderr) => {

      // execFile error (non-zero exit, timeout, etc.)
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }

      // Verify output file exists
      if (!fs.existsSync(outputFile)) {
        const noOutput = new Error('OpenSCAD exited without producing an STL file.');
        noOutput.stderr = stderr;
        return reject(noOutput);
      }

      // Read and validate minimum STL size
      const stl = fs.readFileSync(outputFile);
      if (stl.length < MIN_STL_BYTES) {
        const tiny = new Error('Output STL is empty or too small to be valid.');
        tiny.stderr = stderr;
        return reject(tiny);
      }

      resolve(stl);
    });
  });
}

// ═════════════════════════════════════════════════════════════════
// Error parser
// ═════════════════════════════════════════════════════════════════

/**
 * Parse OpenSCAD's stderr into an array of structured error objects.
 *
 * Common OpenSCAD stderr formats:
 *   ERROR: Parser error in file "input.scad", line 12: syntax error
 *   WARNING: ... in file "input.scad", line 3
 *   ECHO: "debug"
 *   input.scad:12: error: ...
 *
 * @param {string} stderr
 * @returns {Array<{type:string, line:number|null, message:string}>}
 */
function parseOpenSCADErrors(stderr) {
  const results = [];
  const seen    = new Set(); // deduplicate identical messages

  for (const raw of stderr.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    // Pattern 1: "ERROR: ... file "...", line N: message"
    const m1 = line.match(
      /^(ERROR|WARNING):\s*(.*?)(?:[,\s]+line\s+(\d+))?[:\s]*(.+)?$/i
    );
    if (m1) {
      const entry = {
        type:    m1[1].toUpperCase(),
        line:    m1[3] ? parseInt(m1[3], 10) : null,
        message: (m1[4] ?? m1[2] ?? line).trim(),
      };
      const key = `${entry.type}|${entry.line}|${entry.message}`;
      if (!seen.has(key)) { seen.add(key); results.push(entry); }
      continue;
    }

    // Pattern 2: "input.scad:N: message"
    const m2 = line.match(/input\.scad:(\d+):\s*(.+)/);
    if (m2) {
      const entry = {
        type:    'ERROR',
        line:    parseInt(m2[1], 10),
        message: m2[2].trim(),
      };
      const key = `${entry.type}|${entry.line}|${entry.message}`;
      if (!seen.has(key)) { seen.add(key); results.push(entry); }
    }
  }

  // Fallback: return raw stderr if nothing parsed
  if (results.length === 0 && stderr.trim().length > 0) {
    results.push({
      type:    'ERROR',
      line:    null,
      message: stderr.trim().slice(0, 800),
    });
  }

  return results;
}

// ═════════════════════════════════════════════════════════════════
// Cleanup
// ═════════════════════════════════════════════════════════════════

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors — temp files will be collected by OS
  }
}

// ═════════════════════════════════════════════════════════════════
// Start
// ═════════════════════════════════════════════════════════════════

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OpenSCAD Studio API listening on http://0.0.0.0:${PORT}`);
  console.log(`  USE_XVFB=${process.env.USE_XVFB ?? 'true (default)'}`);
});
