import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  access,
  symlink,
  rm,
  realpath,
  open,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pruneDesktopBackups } from "../scripts/prune-desktop-backups.mjs";

async function fixture(t) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "desktop-retention-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  async function bundle(name, version = "1.0.0", extra = {}) {
    const path = join(root, name);
    await mkdir(join(path, "Contents/Resources/app"), { recursive: true });
    await mkdir(join(path, "Contents/MacOS"), { recursive: true });
    await writeFile(
      join(path, "Contents/Resources/app/package.json"),
      JSON.stringify({ name: "open-medical-desktop", version, ...extra }),
    );
    await writeFile(join(path, "Contents/MacOS/Open Medical"), "fixture");
    return path;
  }
  return {
    root,
    bundle,
    options: {
      root,
      apply: true,
      now: Date.now() + 2 * 3600000,
      getOpenFiles: async () => [],
    },
  };
}

test("retention keeps the newest version and preserves unrelated media, release and candidates", async (t) => {
  const { root, bundle, options } = await fixture(t);
  const latest = await bundle("output/previous-latest.app", "1.0.10");
  const old = await bundle("output/package/previous-installed.app", "1.0.9");
  const candidate = await bundle("output/candidate/Open Medical.app");
  const release = await bundle("release/previous.app");
  const other = await bundle("output/previous-other.app", "1.0.0", {
    name: "another-product",
  });
  const media = join(root, "output/demo.mp4");
  await writeFile(media, "video");
  const result = await pruneDesktopBackups(options);
  assert.deepEqual(result.removed, [old]);
  for (const path of [latest, candidate, release, other]) await access(path);
  assert.equal(await readFile(media, "utf8"), "video");
});

test("preview does not delete and in-use or recent backups are protected", async (t) => {
  const { root, bundle, options } = await fixture(t);
  await bundle("output/previous-new.app", "2.0.0");
  const old = await bundle("output/previous-old.app");
  assert.deepEqual(
    (await pruneDesktopBackups({ ...options, apply: false })).removed,
    [],
  );
  await access(old);
  assert.deepEqual(
    (
      await pruneDesktopBackups({
        ...options,
        getOpenFiles: async () => [join(old, "Contents/MacOS/Open Medical")],
      })
    ).protected,
    [old],
  );
  await symlink(old, join(root, "open-alias"));
  assert.deepEqual(
    (
      await pruneDesktopBackups({
        ...options,
        getOpenFiles: async () => [
          join(root, "open-alias/Contents/MacOS/Open Medical"),
        ],
      })
    ).protected,
    [old],
  );
  assert.deepEqual(
    (await pruneDesktopBackups({ ...options, now: Date.now() })).protected,
    [old],
  );
  await access(old);
});

test("symlinked output, linked bundles and bundles containing local data cannot be pruned", async (t) => {
  const { root, bundle, options } = await fixture(t);
  await bundle("output/previous-new.app", "2.0.0");
  const privateBundle = await bundle("output/previous-data.app");
  await mkdir(join(privateBundle, "Contents/Resources/app/server/data"), {
    recursive: true,
  });
  const outside = await bundle("elsewhere/previous-outside.app");
  await symlink(outside, join(root, "output/previous-linked.app"));
  await symlink(join(root, "elsewhere"), join(root, "output/linked-directory"));
  assert.deepEqual((await pruneDesktopBackups(options)).removed, []);
  await access(privateBundle);
  await access(outside);
  await rm(join(root, "output"), { recursive: true });
  await symlink(join(root, "elsewhere"), join(root, "output"));
  await assert.rejects(pruneDesktopBackups(options), /real directory/);
  await access(outside);
});

test("failed open-file inspection and concurrent replacement fail closed", async (t) => {
  const { bundle, options } = await fixture(t);
  await bundle("output/previous-new.app", "2.0.0");
  const old = await bundle("output/previous-old.app");
  await assert.rejects(
    pruneDesktopBackups({
      ...options,
      getOpenFiles: async () => {
        throw new Error("inspection failed");
      },
    }),
    /inspection failed/,
  );
  await access(old);
  await assert.rejects(
    pruneDesktopBackups({
      ...options,
      getOpenFiles: async () => {
        await rm(old, { recursive: true });
        await bundle("output/previous-old.app", "3.0.0");
        return [];
      },
    }),
    /changed during cleanup/,
  );
  await access(old);
  await assert.rejects(
    pruneDesktopBackups({ ...options, keep: 0 }),
    /at least one/,
  );
});

test("macOS open-file inspection protects a real held file during cleanup", async (t) => {
  if (process.platform !== "darwin") return t.skip("macOS lsof integration");
  const { bundle, options } = await fixture(t);
  await bundle("output/previous-new.app", "2.0.0");
  const active = await bundle("output/previous-active.app", "1.0.1");
  const unused = await bundle("output/previous-unused.app", "1.0.0");
  const handle = await open(join(active, "Contents/MacOS/Open Medical"), "r");
  try {
    const result = await pruneDesktopBackups({
      ...options,
      getOpenFiles: undefined,
    });
    assert.deepEqual(result.protected, [active]);
    assert.deepEqual(result.removed, [unused]);
    await access(active);
  } finally {
    await handle.close();
  }
});
