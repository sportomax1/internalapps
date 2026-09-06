import crypto from 'node:crypto';
import path from 'node:path';
import SftpClient from 'ssh2-sftp-client';

export const config = { maxDuration: 30 };

const ALLOWED_HOST = '1.studio.boardgamearena.com';
const ALLOWED_PORT = 2022;
const PREVIEW_LIMIT = 1024 * 1024;
const MAX_DOWNLOAD = 25 * 1024 * 1024;

function reqId() {
  return crypto.randomBytes(4).toString('hex');
}

function safeError(error) {
  const code = String(error?.code || error?.level || '').trim();
  const raw = String(error?.message || 'SFTP request failed.');
  let hint = '';

  if (/authentication|all configured authentication methods failed|permission denied/i.test(raw)) {
    hint = 'Check the BGA Studio username/password. If you uploaded an SSH key in BGA Studio, password authentication may be disabled.';
  } else if (/timed out|timeout|ETIMEDOUT/i.test(raw)) {
    hint = 'The Vercel function could not reach the BGA SFTP server before timeout.';
  } else if (/ENOTFOUND|getaddrinfo/i.test(raw)) {
    hint = 'DNS lookup failed for the BGA SFTP host.';
  } else if (/ECONNREFUSED/i.test(raw)) {
    hint = 'The BGA SFTP server refused the connection on port 2022.';
  }

  return { message: raw.slice(0, 500), code: code || null, hint };
}

function credentials(body = {}) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (!username || !password) {
    const error = new Error('SFTP username and password are required.');
    error.statusCode = 400;
    throw error;
  }

  if (username.length > 128 || password.length > 512) {
    const error = new Error('Credential fields are too long.');
    error.statusCode = 400;
    throw error;
  }

  return { username, password };
}

function remotePath(value) {
  const raw = String(value ?? '.').trim() || '.';
  if (raw.length > 2048 || raw.includes('\0')) {
    const error = new Error('Invalid remote path.');
    error.statusCode = 400;
    throw error;
  }
  return raw;
}

function childPath(parent, name) {
  if (parent === '/') return `/${name}`;
  if (parent === '.') return `./${name}`;
  return path.posix.join(parent, name);
}

async function withSftp(auth, id, operation) {
  const client = new SftpClient(`internalapps-${id}`);
  const started = Date.now();
  console.log(`[sftp:${id}] connect start host=${ALLOWED_HOST} port=${ALLOWED_PORT} user=${auth.username}`);

  try {
    await client.connect({
      host: ALLOWED_HOST,
      port: ALLOWED_PORT,
      username: auth.username,
      password: auth.password,
      readyTimeout: 12000,
      keepaliveInterval: 5000,
      keepaliveCountMax: 2,
    });

    console.log(`[sftp:${id}] connected ms=${Date.now() - started}`);
    return await operation(client);
  } finally {
    try {
      await client.end();
      console.log(`[sftp:${id}] disconnected`);
    } catch (endError) {
      console.warn(`[sftp:${id}] disconnect warning=${String(endError?.message || endError).slice(0, 200)}`);
    }
  }
}

export default async function handler(req, res) {
  const id = reqId();
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-SFTP-Request-ID', id);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.', requestId: id });
  }

  const action = String(req.body?.action || '').toLowerCase();
  console.log(`[sftp:${id}] request action=${action || '(missing)'}`);

  try {
    const auth = credentials(req.body);

    if (action === 'test') {
      const result = await withSftp(auth, id, async (client) => {
        let cwd = '.';
        try {
          cwd = await client.realPath('.');
        } catch {}
        const items = await client.list(cwd);
        return { cwd, itemCount: items.length };
      });

      return res.status(200).json({ ok: true, ...result, requestId: id });
    }

    if (action === 'list') {
      const target = remotePath(req.body?.path);
      const result = await withSftp(auth, id, async (client) => {
        const items = await client.list(target);
        return items.map((item) => ({
          name: item.name,
          type: item.type,
          size: Number(item.size || 0),
          modifyTime: item.modifyTime || null,
          accessTime: item.accessTime || null,
          rights: item.rights || null,
          owner: item.owner ?? null,
          group: item.group ?? null,
          path: childPath(target, item.name),
        }));
      });

      console.log(`[sftp:${id}] list path=${target} count=${result.length}`);
      return res.status(200).json({ ok: true, path: target, entries: result, requestId: id });
    }

    if (action === 'read') {
      const target = remotePath(req.body?.path);
      const result = await withSftp(auth, id, async (client) => {
        const stat = await client.stat(target);

        if (stat.isDirectory) {
          const error = new Error('Cannot preview a directory.');
          error.statusCode = 400;
          throw error;
        }

        if (stat.size > 12 * 1024 * 1024) {
          const error = new Error('File is too large to preview. Use Download instead.');
          error.statusCode = 413;
          throw error;
        }

        const data = await client.get(target);
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
        let nuls = 0;
        for (const byte of sample) if (byte === 0) nuls += 1;

        if (nuls > 4) {
          const error = new Error('This appears to be a binary file. Use Download instead.');
          error.statusCode = 415;
          throw error;
        }

        const view = buffer.subarray(0, PREVIEW_LIMIT);
        return {
          text: view.toString('utf8'),
          truncated: buffer.length > PREVIEW_LIMIT,
          totalBytes: buffer.length,
          limitBytes: PREVIEW_LIMIT,
        };
      });

      console.log(`[sftp:${id}] read path=${target} bytes=${result.totalBytes} truncated=${result.truncated}`);
      return res.status(200).json({ ok: true, ...result, requestId: id });
    }

    if (action === 'download') {
      const target = remotePath(req.body?.path);
      const buffer = await withSftp(auth, id, async (client) => {
        const stat = await client.stat(target);

        if (stat.isDirectory) {
          const error = new Error('Cannot download a directory.');
          error.statusCode = 400;
          throw error;
        }

        if (stat.size > MAX_DOWNLOAD) {
          const error = new Error(`Downloads are limited to ${Math.round(MAX_DOWNLOAD / 1024 / 1024)} MB through this Vercel tool.`);
          error.statusCode = 413;
          throw error;
        }

        const data = await client.get(target);
        return Buffer.isBuffer(data) ? data : Buffer.from(data);
      });

      const filename = path.posix.basename(target) || 'download.bin';
      console.log(`[sftp:${id}] download path=${target} bytes=${buffer.length}`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      return res.status(200).send(buffer);
    }

    return res.status(400).json({ ok: false, error: 'Unknown action.', requestId: id });
  } catch (error) {
    const status = Number(error?.statusCode) || 502;
    const details = safeError(error);
    console.error(`[sftp:${id}] failed status=${status} code=${details.code || '-'} message=${details.message}`);
    return res.status(status).json({
      ok: false,
      error: details.message,
      code: details.code,
      hint: details.hint,
      requestId: id,
    });
  }
}
