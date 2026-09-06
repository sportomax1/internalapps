import crypto from 'node:crypto';
import path from 'node:path';
import SftpClient from 'ssh2-sftp-client';

export const config = { maxDuration: 30 };

const ALLOWED_HOST = '1.studio.boardgamearena.com';
const ALLOWED_PORT = 2022;
const PREVIEW_LIMIT = 1024 * 1024;
const MAX_PREVIEW_SOURCE = 4 * 1024 * 1024;
const MAX_DOWNLOAD = 4 * 1024 * 1024;
const MAX_UPLOAD = 2560 * 1024; // 2.5 MB raw; base64 stays below Vercel request limits
const APP_TOKEN_TTL_MS = 60 * 60 * 1000;
const MUTATION_ACTIONS = new Set(['mkdir', 'write', 'rename', 'delete']);

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

function httpError(message, statusCode = 400, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
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
    readOnly: false,
    crudEnabled: !!appSecret(),
    mutationRequiresAppPassword: true,
    previewLimitBytes: PREVIEW_LIMIT,
    downloadLimitBytes: MAX_DOWNLOAD,
    uploadLimitBytes: MAX_UPLOAD,
    mutationActions: [...MUTATION_ACTIONS],
  };
}

function appGate(body = {}) {
  const secret = appSecret();
  const mode = String(body.authMode || 'manual').toLowerCase();

  if (!secret) {
    if (mode === 'saved') {
      throw httpError(
        'Saved SFTP credentials require APP_PASSWORD (or PERSONAL_PASSWORD) to be configured in Vercel.',
        503,
        'APP_PASSWORD_NOT_CONFIGURED',
      );
    }
    return { protected: false };
  }

  if (verifyAppToken(String(body.appToken || ''), secret)) {
    return { protected: true };
  }

  if (safeEqual(String(body.appPassword || ''), secret)) {
    return { protected: true };
  }

  throw httpError('Incorrect or expired Internal Apps password.', 401, 'APP_AUTH_FAILED');
}

function requireMutationAuthorization(body, gate, expectedKind, expectedTarget) {
  if (!appSecret() || !gate?.protected) {
    throw httpError(
      'Create, update, and delete operations require APP_PASSWORD to be configured and unlocked.',
      503,
      'SFTP_MUTATION_GATE_REQUIRED',
    );
  }

  const kind = String(body.confirmMutation || '').toLowerCase();
  const target = String(body.confirmTarget || '');

  if (kind !== expectedKind || target !== expectedTarget) {
    throw httpError(
      `Server-side ${expectedKind.toUpperCase()} confirmation is missing or does not match the target.`,
      400,
      'SFTP_MUTATION_CONFIRMATION_REQUIRED',
    );
  }
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
      throw httpError(
        'No SFTP username was supplied and SFTP_USERNAME is not configured.',
        503,
        'SFTP_USERNAME_MISSING',
      );
    }

    const useKey = configuredMethod === 'key' || (!configuredMethod && !!savedKey);
    const usePassword = configuredMethod === 'password' || (!configuredMethod && !savedKey && !!savedPassword);

    if (useKey) {
      if (!savedKey) {
        throw httpError(
          'SFTP_AUTH_METHOD is key, but SFTP_PRIVATE_KEY is not configured.',
          503,
          'SFTP_PRIVATE_KEY_MISSING',
        );
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
        throw httpError(
          'SFTP_AUTH_METHOD is password, but SFTP_PASSWORD is not configured.',
          503,
          'SFTP_PASSWORD_MISSING',
        );
      }
      return { mode, username, password: savedPassword };
    }

    throw httpError(
      'No saved SFTP authentication is configured. Add SFTP_PASSWORD or SFTP_PRIVATE_KEY in Vercel.',
      503,
      'SFTP_SAVED_CREDENTIALS_MISSING',
    );
  }

  const username = suppliedUsername;
  const password = String(body.password || '');

  if (!username || !password) {
    throw httpError(
      'SFTP username and password are required for manual mode.',
      400,
      'SFTP_MANUAL_CREDENTIALS_MISSING',
    );
  }

  if (username.length > 128 || password.length > 512) {
    throw httpError('Credential fields are too long.', 400, 'SFTP_CREDENTIALS_TOO_LONG');
  }

  return { mode: 'manual', username, password };
}

function remotePath(value) {
  const raw = String(value ?? '.').trim() || '.';
  if (raw.length > 2048 || raw.includes('\0')) {
    throw httpError('Invalid remote path.', 400, 'INVALID_REMOTE_PATH');
  }
  return raw;
}

function mutablePath(value) {
  const target = remotePath(value);
  if (target === '.' || target === '/' || target === '') {
    throw httpError('The SFTP root/default directory itself cannot be modified.', 400, 'PROTECTED_REMOTE_PATH');
  }
  return target;
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

function decodeWriteBuffer(body = {}) {
  if (Object.prototype.hasOwnProperty.call(body, 'text')) {
    const buffer = Buffer.from(String(body.text ?? ''), 'utf8');
    if (buffer.length > MAX_UPLOAD) {
      throw httpError(
        `Uploads/updates are limited to ${Math.round(MAX_UPLOAD / 1024 / 1024 * 10) / 10} MB on the Vercel-hosted explorer.`,
        413,
        'SFTP_UPLOAD_TOO_LARGE',
      );
    }
    return buffer;
  }

  const raw = String(body.contentBase64 || '');
  if (!raw) {
    throw httpError('No file content was supplied.', 400, 'SFTP_WRITE_CONTENT_MISSING');
  }

  if (raw.length > Math.ceil(MAX_UPLOAD * 4 / 3) + 16) {
    throw httpError(
      `Uploads are limited to ${Math.round(MAX_UPLOAD / 1024 / 1024 * 10) / 10} MB on the Vercel-hosted explorer.`,
      413,
      'SFTP_UPLOAD_TOO_LARGE',
    );
  }

  let buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch {
    throw httpError('Upload content was not valid base64.', 400, 'SFTP_INVALID_BASE64');
  }

  if (buffer.length > MAX_UPLOAD) {
    throw httpError(
      `Uploads are limited to ${Math.round(MAX_UPLOAD / 1024 / 1024 * 10) / 10} MB on the Vercel-hosted explorer.`,
      413,
      'SFTP_UPLOAD_TOO_LARGE',
    );
  }
  return buffer;
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
  } else if (/permission/i.test(raw)) {
    hint = 'The BGA Studio SFTP account does not have permission for this operation/path.';
  }

  return { message: raw.slice(0, 500), code: code || null, hint };
}

async function withSftp(auth, id, operation) {
  const client = new SftpClient(`internalapps-${id}`);
  const started = Date.now();
  console.log(
    `[sftp:${id}] connect start host=${ALLOWED_HOST} port=${ALLOWED_PORT} mode=${auth.mode} user=${maskedUser(auth.username)}`,
  );

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
        throw httpError('Incorrect Internal Apps password.', 401, 'APP_AUTH_FAILED');
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

    const gate = appGate(req.body);
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
      return res.status(200).json({
        ok: true,
        path: target,
        entries: result,
        authMode: auth.mode,
        requestId: id,
      });
    }

    if (action === 'read') {
      const target = remotePath(req.body?.path);
      const result = await withSftp(auth, id, async (client) => {
        const stat = await client.stat(target);

        if (stat.isDirectory) {
          throw httpError('Cannot preview a directory.', 400, 'SFTP_READ_DIRECTORY');
        }

        if (stat.size > MAX_PREVIEW_SOURCE) {
          throw httpError(
            'File is too large to preview through the Vercel SFTP tool.',
            413,
            'SFTP_PREVIEW_TOO_LARGE',
          );
        }

        const data = await client.get(target);
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
        let nuls = 0;
        for (const byte of sample) if (byte === 0) nuls += 1;

        if (nuls > 4) {
          throw httpError(
            'This appears to be a binary file. Use Download instead.',
            415,
            'SFTP_BINARY_PREVIEW',
          );
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
          throw httpError('Cannot download a directory.', 400, 'SFTP_DOWNLOAD_DIRECTORY');
        }

        if (stat.size > MAX_DOWNLOAD) {
          throw httpError(
            `Downloads are limited to ${Math.round(MAX_DOWNLOAD / 1024 / 1024)} MB because Vercel Functions cap normal response payloads.`,
            413,
            'SFTP_DOWNLOAD_TOO_LARGE',
          );
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

    if (action === 'mkdir') {
      const target = mutablePath(req.body?.path);
      requireMutationAuthorization(req.body, gate, 'create', target);

      await withSftp(auth, id, async (client) => {
        const exists = await client.exists(target);
        if (exists) {
          throw httpError('A file or folder already exists at that path.', 409, 'SFTP_TARGET_EXISTS');
        }
        await client.mkdir(target, false);
      });

      console.log(`[sftp:${id}] mkdir path=${target}`);
      return res.status(200).json({ ok: true, action, path: target, requestId: id });
    }

    if (action === 'write') {
      const target = mutablePath(req.body?.path);
      const writeMode = String(req.body?.writeMode || '').toLowerCase();
      if (!['create', 'update'].includes(writeMode)) {
        throw httpError('writeMode must be create or update.', 400, 'SFTP_WRITE_MODE_INVALID');
      }
      requireMutationAuthorization(req.body, gate, writeMode, target);
      const buffer = decodeWriteBuffer(req.body);

      await withSftp(auth, id, async (client) => {
        const exists = await client.exists(target);
        if (writeMode === 'create' && exists) {
          throw httpError('The target already exists. Use Update/Overwrite instead.', 409, 'SFTP_TARGET_EXISTS');
        }
        if (writeMode === 'update' && !exists) {
          throw httpError('The target no longer exists. Refresh and try again.', 404, 'SFTP_TARGET_MISSING');
        }
        if (exists === 'd') {
          throw httpError('Cannot write file contents to a directory.', 400, 'SFTP_WRITE_DIRECTORY');
        }
        await client.put(buffer, target);
      });

      console.log(`[sftp:${id}] write mode=${writeMode} path=${target} bytes=${buffer.length}`);
      return res.status(200).json({
        ok: true,
        action,
        writeMode,
        path: target,
        bytes: buffer.length,
        requestId: id,
      });
    }

    if (action === 'rename') {
      const from = mutablePath(req.body?.from);
      const to = mutablePath(req.body?.to);
      const confirmationTarget = `${from} -> ${to}`;
      requireMutationAuthorization(req.body, gate, 'update', confirmationTarget);

      if (from === to) {
        throw httpError('Source and destination are the same.', 400, 'SFTP_RENAME_SAME_PATH');
      }

      await withSftp(auth, id, async (client) => {
        const sourceExists = await client.exists(from);
        if (!sourceExists) {
          throw httpError('The source path no longer exists.', 404, 'SFTP_SOURCE_MISSING');
        }
        const destinationExists = await client.exists(to);
        if (destinationExists) {
          throw httpError('The destination path already exists.', 409, 'SFTP_DESTINATION_EXISTS');
        }
        await client.rename(from, to);
      });

      console.log(`[sftp:${id}] rename from=${from} to=${to}`);
      return res.status(200).json({ ok: true, action, from, to, requestId: id });
    }

    if (action === 'delete') {
      const target = mutablePath(req.body?.path);
      requireMutationAuthorization(req.body, gate, 'delete', target);
      const recursive = req.body?.recursive === true;

      const deletedType = await withSftp(auth, id, async (client) => {
        const exists = await client.exists(target);
        if (!exists) {
          throw httpError('The target no longer exists.', 404, 'SFTP_TARGET_MISSING');
        }
        if (exists === 'd') {
          await client.rmdir(target, recursive);
          return 'directory';
        }
        await client.delete(target, false);
        return exists === 'l' ? 'symlink' : 'file';
      });

      console.log(`[sftp:${id}] delete type=${deletedType} recursive=${recursive} path=${target}`);
      return res.status(200).json({
        ok: true,
        action,
        path: target,
        deletedType,
        recursive,
        requestId: id,
      });
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
