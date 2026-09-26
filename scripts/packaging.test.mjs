// Packaging checks: the four manifests agree with each other, the extension ships every file its
// server needs, and every file a skill points to exists. Drift here breaks an install, not a test.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const plugin = json(".claude-plugin/plugin.json");
const market = json(".claude-plugin/marketplace.json");
const manifest = json("manifest.json");
const mcp = json(".mcp.json");
const pkg = json("package.json");

describe("the manifests agree", () => {
  it("one name and one version everywhere", () => {
    assert.equal(plugin.name, "grill");
    assert.equal(market.name, "grill");
    assert.equal(market.plugins[0].name, plugin.name);
    assert.equal(market.plugins[0].source, ".");
    assert.equal(manifest.name, plugin.name);
    assert.equal(manifest.version, plugin.version);
    assert.equal(pkg.version, plugin.version);
  });

  it("the key setting has the same name in the plugin, its MCP config and the extension, and is always sensitive", () => {
    const ref = "${user_config.openrouter_api_key}";
    assert.equal(plugin.userConfig.openrouter_api_key.sensitive, true);
    assert.equal(manifest.user_config.openrouter_api_key.sensitive, true);
    assert.equal(mcp.mcpServers.grill.env.GRILL_API_KEY, ref);
    assert.equal(manifest.server.mcp_config.env.GRILL_API_KEY, ref);
  });

  it("both launch the same server file, which exists", () => {
    assert.equal(manifest.server.entry_point, "server/index.mjs");
    assert.deepEqual(manifest.server.mcp_config.args, ["${__dirname}/server/index.mjs"]);
    assert.deepEqual(mcp.mcpServers.grill.args, ["${CLAUDE_PLUGIN_ROOT}/server/index.mjs"]);
    assert.ok(existsSync(join(ROOT, "server/index.mjs")));
  });

  it("the extension declares exactly the tools the server serves, and a privacy policy", () => {
    assert.deepEqual(manifest.tools.map((t) => t.name), ["grill", "grill_result"]);
    assert.ok(manifest.privacy_policies.some((u) => u.includes("openrouter.ai")));
  });
});

describe("the extension build", () => {
  it("stages every file the server reaches, keeping the relative layout", () => {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-extension.mjs")], { stdio: "pipe" });
    const staged = join(ROOT, "dist/extension");
    for (const f of ["manifest.json", "server/index.mjs", "scripts/judge.mjs", "scripts/judgeCore.mjs"]) {
      assert.ok(existsSync(join(staged, f)), `missing ${f}`);
    }
    const server = readFileSync(join(ROOT, "server/index.mjs"), "utf8");
    assert.match(server, /new URL\("\.\.\/scripts\/judge\.mjs", import\.meta\.url\)/);
    const judge = readFileSync(join(ROOT, "scripts/judge.mjs"), "utf8");
    for (const [, rel] of judge.matchAll(/from "\.\/([^"]+)"/g)) {
      assert.ok(existsSync(join(staged, "scripts", rel)), `judge.mjs imports ${rel}, which the build does not stage`);
    }
  });
});

describe("the skills", () => {
  const skills = readdirSync(join(ROOT, "skills"));

  it("each SKILL.md names itself after its folder and has a description", () => {
    assert.deepEqual(skills.sort(), ["grill", "weekly-review"]);
    for (const s of skills) {
      const text = readFileSync(join(ROOT, "skills", s, "SKILL.md"), "utf8");
      const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
      assert.ok(fm, `${s} has no frontmatter`);
      assert.match(fm[1], new RegExp(`^name: ${s}$`, "m"));
      assert.match(fm[1], /^description: .{80,}$/m);
    }
  });

  it("every file a skill points to exists", () => {
    const refs = {
      grill: ["paste-prompt.md"],
      "weekly-review": ["the-count.md", "templates/decision-record.md", "templates/weekly-note.md"],
    };
    for (const [skill, files] of Object.entries(refs)) {
      const text = readFileSync(join(ROOT, "skills", skill, "SKILL.md"), "utf8");
      for (const f of files) {
        assert.ok(text.includes(f.split("/").pop()), `${skill}/SKILL.md no longer mentions ${f}`);
        assert.ok(existsSync(join(ROOT, "skills", skill, f)), `${skill}/${f} is missing`);
      }
    }
  });

  it("the paste prompt keeps both placeholders the skill fills", () => {
    const text = readFileSync(join(ROOT, "skills/grill/paste-prompt.md"), "utf8");
    assert.ok(text.includes("{THE APPROVED SUBJECT}"));
    assert.ok(text.includes("{THE NEUTRAL QUESTION}"));
  });
});
