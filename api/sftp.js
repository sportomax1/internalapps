import crypto from 'node:crypto';
import path from 'node:path';
import SftpClient from 'ssh2-sftp-client';

export const config = { maxDuration: 30 };

const ALLOWED_HOST = '1.studio.boardgamearena.com';
const ALLOWED_PORT = 2022;
const PREVIEW_LIMIT = 1024 * 1024;
const MAX_PREVIEW_SOURCE = 4 * 1024 * 1024;
const MAX_DOWNLOAD = 4 * 1024 * 1024;
const APP_TOKEN_TTL_MS = 60 * 60 * 1000;

function reqId() {
  return crypto.randomBytes(4).toString('hex');
}

function appSecret() {
  return String(process.env.APP_PASSWORD || process.env.PERSONAL_PASSWORD || '');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function mintAppToken(secret) {
  const payload = Buffer.from(JSON.stringify({
    exp: Date.now() + APP_TOKEN_TTL_MS,
    nonce: crypto.randomBytes(8).toString('hex'),
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyAppToken(token, secret) {
  if (!token || !secret || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(parsed.exp) > Date.now();
  } catch {
    return false;
  }
}

function statusPayload() {
  const savedKeyConfigured = !!process.env.SFTP_PRIVATE_KEY;
  const savedPasswordConfigured = !!process.env.SFTP_PASSWORD;
  return {
    appProtected: !!appSecret(),
    savedUsernameConfigured: !!(process.env.SFTP_USERNAME || process.env.SFTP_USER),
    savedPasswordConfigured,
    savedKeyConfigured,
    savedAuthConfigured: savedKeyConfigured || savedPasswordConfigured,
    savedAuthMethod: savedKeyConfigured ? 'key' : savedPasswordConfigured ? 'password' : null,
    host: ALLOWED_HOST,
    port: ALLOWED_PORT,
    readOnly: true,
    previewLimitBytes: PREVIEW_LIMIT,
    downloadLimitBytes: MAX_DOWNLOAD,
  };
}

function appGate(body = {}) {
  const secret = appSecret();
  const mode = String(body.authMode || 'manual').toLowerCase();

  if (!secret) {
    if (mode === 'saved') {
      const error = new Error('Saved SFTP credentials require APP_PASSWORD (or PERSONAL_PASSWORD) to be configured in Vercel.');
      error.statusCode = 503;
      error.code = 'APP_PASSWORD_NOT_CONFIGURED';
      throw error;
    }
    return { protected: false };
  }

  if (verifyAppToken(String(body.appToken || ''), secret)) {
    return { protected: true };
  }

  if (safeEqual(String(body.appPassword || ''), secret)) {
    return { protected: true };
  }

  const error = new Error('Incorrect or expired Internal Apps password.');
  error.statusCode = 401;
  error.code = 'APP_AUTH_FAILED';
  throw error;
}

function normalizePrivateKey(raw) {
  const value = String(raw || '');
  if (!value) return '';
  if (value.includes('\\n') && !value.includes('\n')) return value.replace(/\\n/g, '\n');
  return value;
}

function credentials(body = {}) {
  const mode = String(body.authMode || 'manual').toLowerCase();
  const suppliedUsername = String(body.username || '').trim();

  if (mode === 'saved') {
    const username = suppliedUsername || String(process.env.SFTP_USERNAME || process.env.SFTP_USER || '').trim();
    const configuredMethod = String(process.env.SFTP_AUTH_METHOD || '').trim().toLowerCase();
    const savedKey = normalizePrivateKey(process.env.SFTP_PRIVATE_KEY);
    const savedPassword = String(process.env.SFTP_PASSWORD || '');

    if (!username) {
      const error = new Error('No SFTP username was supplied and SFTP_USERNAME is not configured.');
      error.statusCode = 503;
      error.code = 'SFTP_USERNAME_MISSING';
      throw error;
    }

    const useKey = configuredMethod === 'key' || (!configuredMethod && !!savedKey);
    const usePassword = configuredMethod === 'password' || (!configuredMethod && !savedKey && !!savedPassword);

    if (useKey) {
      if (!savedKey) {
        const error = new Error('SFTP_AUTH_METHOD is key, but SFTP_PRIVATE_KEY is not configured.');
        error.statusCode = 503;
        error.code = 'SFTP_PRIVATE_KEY_MISSING';
        throw error;
      }
      return {
        mode,
        username,
        privateKey: savedKey,
        passphrase: process.env.SFTP_PASSPHRASE || undefined,
      };
    }

    if (usePassword) {
      if (!savedPassword) {
        const error = new Error('SFTP_AUTH_METHOD is password, but SFTP_PASSWORD is not configured.');
        error.statusCode = 503;
        error.code = 'SFTP_PASSWORD_MISSING';
        throw error;
      }
      return { mode, username, password: savedPassword };
    }

    const error = new Error('No saved SFTP authentication is configured. Add SFTP_PASSWORD or SFTP_PRIVATE_KEY in Vercel.');
    error.statusCode = 503;
    error.code = 'SFTP_SAVED_CREDENTIALS_MISSING';
    throw error;
  }

  const username = suppliedUsername;
  const password = String(body.password || '');

  if (!username || !password) {
    const error = new Error('SFTP username and password are required for manual mode.');
    error.statusCode = 400;
    error.code = 'SFTP_MANUAL_CREDENTIALS_MISSING';
    throw error;
  }

  if (username.length > 128 || password.length > 512) {
    const error = new Error('Credential fields are too long.');
    error.statusCode = 400;
    error.code = 'SFTP_CREDENTIALS_TOO_LONG';
    throw error;
  }

  return { mode: 'manual', username, password };
}

function remotePath(value) {
  const raw = String(value ?? '.').trim() || '.';
  if (raw.length > 2048 || raw.includes('\0')) {
    const error = new Error('Invalid remote path.');
    error.statusCode = 400;
    error.code = 'INVALID_REMOTE_PATH';
    throw error;
  }
  return raw;
}

function childPath(parent, name) {
  if (parent === '/') return `/${name}`;
  if (parent === '.') return `./${name}`;
  return path.posix.join(parent, name);
}

function maskedUser(username) {
  if (!username) return '-';
  return `${username.slice(0, 1)}***(${username.length})`;
}

function safeError(error) {
  const code = String(error?.code || error?.level || '').trim();
  const raw = String(error?.message || 'SFTP request failed.');
  let hint = '';

  if (/authentication|all configured authentication methods failed|permission denied/i.test(raw)) {
    hint = 'Check the BGA Studio authentication method. BGA may disable password authentication after an SSH key is uploaded.';
  } else if (/timed out|timeout|ETIMEDOUT/i.test(raw)) {
    hint = 'The Vercel function could not reach the BGA SFTP server before timeout.';
  } else if (/ENOTFOUND|getaddrinfo/i.test(raw)) {
    hint = 'DNS lookup failed for the BGA SFTP host.';
  } else if (/ECONNREFUSED/i.test(raw)) {
    hint = 'The BGA SFTP server refused the connection on port 2022.';
  } else if (code === 'APP_AUTH_FAILED') {
    hint = 'Re-enter the Internal Apps password to unlock the SFTP tool.';
  }

  return { message: raw.slice(0, 500), code: code || null, hint };
}

async function withSftp(auth, id, operation) {
  const client = new SftpClient(`internalapps-${id}`);
  const started = Date.now();
  console.log(`[sftp:${id}] connect start host=${ALLOWED_HOST} port=${ALLOWED_PORT} mode=${auth.mode} user=${maskedUser(auth.username)}`);

  const connectConfig = {
    host: ALLOWED_HOST,
    port: ALLOWED_PORT,
    username: auth.username,
    readyTimeout: 12000,
    keepaliveInterval: 5000,
    keepaliveCountMax: 2,
  };

  if (auth.privateKey) {
    connectConfig.privateKey = auth.privateKey;
    if (auth.passphrase) connectConfig.passphrase = auth.passphrase;
  } else {
    connectConfig.password = auth.password;
  }

  try {
    await client.connect(connectConfig);
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
    if (action === 'status') {
      return res.status(200).json({ ok: true, ...statusPayload(), requestId: id });
    }

    if (action === 'unlock') {
      const secret = appSecret();
      if (!secret) {
        return res.status(200).json({
          ok: true,
          appProtected: false,
          token: null,
          expiresAt: null,
          requestId: id,
        });
      }

      if (!safeEqual(String(req.body?.appPassword || ''), secret)) {
        const error = new Error('Incorrect Internal Apps password.');
        error.statusCode = 401;
        error.code = 'APP_AUTH_FAILED';
        throw error;
      }

      const token = mintAppToken(secret);
      return res.status(200).json({
        ok: true,
        appProtected: true,
        token,
        expiresAt: new Date(Date.now() + APP_TOKEN_TTL_MS).toISOString(),
        requestId: id,
      });
    }

    appGate(req.body);
    const auth = credentials(req.body);
    res.setHeader('X-SFTP-Auth-Mode', auth.mode);

    if (action === 'test') {
      const result = await withSftp(auth, id, async (client) => {
        let cwd = '.';
        try {
          cwd = await client.realPath('.');
        } catch {}
        const items = await client.list(cwd);
        return { cwd, itemCount: items.length };
      });

      return res.status(200).json({ ok: true, ...result, authMode: auth.mode, requestId: id });
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
      return res.status(200).json({ ok: true, path: target, entries: result, authMode: auth.mode, requestId: id });
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

        if (stat.size > MAX_PREVIEW_SOURCE) {
          const error = new Error('File is too large to preview through the Vercel SFTP tool.');
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
      return res.status(200).json({ ok: true, ...result, authMode: auth.mode, requestId: id });
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
          const error = new Error(`Downloads are limited to ${Math.round(MAX_DOWNLOAD / 1024 / 1024)} MB because Vercel Functions cap normal response payloads at 4.5 MB.`);
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
    const code = String(error?.code || details.code || '').trim() || null;
    console.error(`[sftp:${id}] failed status=${status} code=${code || '-'} message=${details.message}`);
    return res.status(status).json({
      ok: false,
      error: details.message,
      code,
      hint: details.hint,
      requestId: id,
    });
  }
}
