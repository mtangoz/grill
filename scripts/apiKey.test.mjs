// The key file: where the judge looks for its key, and the one command that writes it.
//
// node:test + node:assert only. Every path is a temp directory; nothing reads the real
// ~/.config, and nothing reaches the network except a loopback stand-in for OpenRouter.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { keyFilePath, maskKey, resolveApiKey, saveApiKey } from "./apiKey.mjs";
import { startFakeOpenRouter } from "./fixtures/fake-openrouter.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "judge.mjs");
const KEY = "sk-or-v1-from-the-key-file-0001";
const posix = process.platform !== "win32";

const tempKeyFile = () => join(mkdtempSync(join(tmpdir(), "grill-key-")), "nested", "key");

function runCli(args, env, stdinText) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { PATH: process.env.PATH, ...env },
      stdio: [stdinText === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    if (stdinText !== undefined) child.stdin.end(stdinText);
  });
}

describe("where the key comes from", () => {
  it("GRILL_API_KEY, then OPENROUTER_API_KEY, then the key file", () => {
    const file = tempKeyFile();
    saveApiKey(KEY, { GRILL_KEY_FILE: file });
    assert.deepEqual(resolveApiKey({ GRILL_KEY_FILE: file, GRILL_API_KEY: "a", OPENROUTER_API_KEY: "b" }).source, "GRILL_API_KEY");
    assert.deepEqual(resolveApiKey({ GRILL_KEY_FILE: file, OPENROUTER_API_KEY: "b" }).source, "OPENROUTER_API_KEY");
    const found = resolveApiKey({ GRILL_KEY_FILE: file });
    assert.equal(found.key, KEY);
    assert.equal(found.source, file);
  });

  it("an unfilled ${…} placeholder or blank variable is no key, and falls through to the file", () => {
    const file = tempKeyFile();
    saveApiKey(KEY, { GRILL_KEY_FILE: file });
    const found = resolveApiKey({ GRILL_KEY_FILE: file, GRILL_API_KEY: "${user_config.openrouter_api_key}", OPENROUTER_API_KEY: "  " });
    assert.equal(found.key, KEY);
  });

  it("no variable and no file is no key, without throwing", () => {
    assert.deepEqual(resolveApiKey({ GRILL_KEY_FILE: tempKeyFile() }), { key: "", source: null });
  });

  it("defaults to $XDG_CONFIG_HOME/grill/key", () => {
    assert.equal(keyFilePath({ XDG_CONFIG_HOME: "/x" }), join("/x", "grill", "key"));
  });

  it("masks a key to its last four characters", () => {
    assert.equal(maskKey(KEY), "…0001");
    assert.equal(maskKey("short"), "…");
  });
});

describe("saving it", () => {
  it("writes mode 600 in a 700 directory, and tightens an existing loose file", { skip: !posix }, async () => {
    const { chmodSync } = await import("node:fs");
    const file = tempKeyFile();
    saveApiKey(KEY, { GRILL_KEY_FILE: file });
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(file)).mode & 0o777, 0o700);
    chmodSync(file, 0o644);
    assert.match(resolveApiKey({ GRILL_KEY_FILE: file }).warning, /chmod 600/);
    saveApiKey(KEY, { GRILL_KEY_FILE: file });
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(resolveApiKey({ GRILL_KEY_FILE: file }).warning, null);
  });

  it("refuses an empty paste or one with spaces in it", () => {
    const file = tempKeyFile();
    assert.throws(() => saveApiKey("  \n", { GRILL_KEY_FILE: file }), /no key/);
    assert.throws(() => saveApiKey("sk-or one two", { GRILL_KEY_FILE: file }), /no spaces/);
  });
});

describe("the CLI", () => {
  it("--set-key reads stdin, and --key-status names the source without printing the key", async () => {
    const file = tempKeyFile();
    const set = await runCli(["--set-key"], { GRILL_KEY_FILE: file }, `${KEY}\n`);
    assert.equal(set.code, 0, set.stderr);
    assert.equal(readFileSync(file, "utf8"), `${KEY}\n`);
    assert.ok(!set.stdout.includes(KEY));

    const status = await runCli(["--key-status"], { GRILL_KEY_FILE: file });
    assert.equal(status.code, 0);
    assert.match(status.stdout, /key found: .*key \(…0001\)/);
    assert.ok(!(status.stdout + status.stderr).includes(KEY), "the key is never printed");
  });

  it("--key-status with nothing found still exits 0 and says where it looked", async () => {
    const file = tempKeyFile();
    const r = await runCli(["--key-status"], { GRILL_KEY_FILE: file });
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes(file));
  });

  it("a real run with no variable uses the key file, and the error names it when it is missing", async () => {
    const file = tempKeyFile();
    const missing = await runCli(["--text", "a claim"], { GRILL_KEY_FILE: file });
    assert.equal(missing.code, 1);
    assert.ok(missing.stderr.includes(file));
    assert.match(missing.stderr, /--set-key/);

    saveApiKey(KEY, { GRILL_KEY_FILE: file });
    const fake = await startFakeOpenRouter();
    const r = await runCli(["--text", "a claim", "--json"], { GRILL_KEY_FILE: file, ...fake.env });
    await fake.close();
    assert.equal(r.code, 0, r.stderr);
    assert.equal(fake.seen.chat.length >= 1, true);
    assert.equal(fake.seen.chat[0].headers.authorization, `Bearer ${KEY}`);
  });
});
