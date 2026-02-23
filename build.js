import fs from 'fs/promises';
import path from 'path';

const root = process.cwd();
const outStatic = path.join(root, '.vercel', 'output', 'static');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

async function copyDir(srcDir, destDir) {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  await ensureDir(destDir);
  for (const ent of entries) {
    const srcPath = path.join(srcDir, ent.name);
    const destPath = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (ent.isFile()) {
      await copyFile(srcPath, destPath);
    }
  }
}

async function main() {
  // Ensure output dir
  await ensureDir(outStatic);

  // Copy root HTML files
  const rootFiles = ['index.html', 'oura.html'];
  for (const f of rootFiles) {
    const src = path.join(root, f);
    try {
      await fs.access(src);
      await copyFile(src, path.join(outStatic, f));
      console.log('copied', f);
    } catch (e) {
      // ignore missing files
    }
  }

  // Copy public and tracking directories if present
  for (const dir of ['public', 'tracking']) {
    const src = path.join(root, dir);
    try {
      await fs.access(src);
      await copyDir(src, path.join(outStatic, dir));
      console.log('copied dir', dir);
    } catch (e) {
      // ignore
    }
  }

  // Optionally copy other static assets at repo root
  // (skip node_modules, .git, api)
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const name = ent.name;
    if (['index.html', 'oura.html', 'package.json'].includes(name)) continue;
    if (name.endsWith('.html') || name.endsWith('.css') || name.endsWith('.js') || name.endsWith('.svg')) {
      await copyFile(path.join(root, name), path.join(outStatic, name));
    }
  }

  console.log('static build complete');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
