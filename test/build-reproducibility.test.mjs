import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
test('independent checkout paths produce identical browser asset names and bytes', async t => {
  await mkdir(join(repo, '.release-work'), { recursive: true });
  const work = await mkdtemp(join(repo, '.release-work', 'build-repro-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const inventories = [];
  for (const name of ['checkout-first', 'different-checkout-name']) {
    const root = join(work, name);
    await mkdir(join(root, 'tools'), { recursive: true });
    for (const source of ['package.json', 'plugins.json', 'index.html', 'src', 'plugins', 'tools/build.mjs', 'tools/plugin-bundle.mjs']) {
      await cp(join(repo, source), join(root, source), { recursive: true });
    }
    await symlink(join(repo, 'node_modules'), join(root, 'node_modules'), 'dir');
    await promisify(execFile)(process.execPath, ['tools/build.mjs'], { cwd: root, timeout: 60000 });
    const inventory = {};
    async function walk(folder) {
      for (const item of await readdir(join(root, folder), { withFileTypes: true })) {
        const path = folder + '/' + item.name;
        if (item.isDirectory()) await walk(path);
        else inventory[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
      }
    }
    await walk('dist');
    inventories.push(inventory);
  }
  assert.deepEqual(inventories[0], inventories[1], 'asset identities must not depend on the absolute checkout directory');
});
