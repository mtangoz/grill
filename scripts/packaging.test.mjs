// Packaging checks: the four manifests agree with each other, the extension ships every file its
// server needs, and every file a skill points to exists. Drift here breaks an install, not a test.
import { describe, it } from "node:test";
import { buildSmitheryBundle, listTools } from "./build-smithery-bundle.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
    assert.equal(market.plugins[0].version, plugin.version);
    assert.equal(json("server.json").version, plugin.version);
    assert.match(readFileSync(join(ROOT, "server/index.mjs"), "utf8"), new RegExp(`^const VERSION = "${plugin.version}";$`, "m"));
  });

  it("one license everywhere, and the MIT text beside it", () => {
    for (const m of [pkg, plugin, manifest]) assert.equal(m.license, "MIT");
    assert.match(readFileSync(join(ROOT, "LICENSE"), "utf8"), /^MIT License\n\nCopyright \(c\) \d{4} /);
  });

  it("the key setting has the same name in the plugin, its MCP config and the extension, and is always sensitive", () => {
    const ref = "${user_config.openrouter_api_key}";
    assert.equal(plugin.userConfig.openrouter_api_key.sensitive, true);
    assert.equal(manifest.user_config.openrouter_api_key.sensitive, true);
    assert.equal(mcp.mcpServers.grill.env.GRILL_API_KEY, ref);
    assert.equal(manifest.server.mcp_config.env.GRILL_API_KEY, ref);
  });

  it("the user_config keys match across manifest.json, plugin.json and .mcp.json", () => {
    // Declared: the same keys, and each the same kind of setting, in the plugin and the extension.
    const keys = Object.keys(manifest.user_config).sort();
    assert.deepEqual(Object.keys(plugin.userConfig).sort(), keys);
    for (const k of keys) {
      for (const field of ["type", "title", "sensitive", "default"]) {
        assert.deepEqual(plugin.userConfig[k][field], manifest.user_config[k][field], `${k}.${field} differs`);
      }
    }
    // Wired: both launchers hand the server the same environment, and every declared key reaches it.
    assert.deepEqual(mcp.mcpServers.grill.env, manifest.server.mcp_config.env);
    const referenced = (env) =>
      Object.values(env)
        .map((v) => String(v).match(/^\$\{user_config\.([a-z0-9_]+)\}$/)?.[1])
        .filter(Boolean)
        .sort();
    assert.deepEqual(referenced(manifest.server.mcp_config.env), keys);
    assert.deepEqual(referenced(mcp.mcpServers.grill.env), keys);
  });

  it("the Jev check is a boolean setting that defaults to ON, says what it sends, and is wired as GRILL_CHECK", () => {
    for (const cfg of [plugin.userConfig.jev_quality_check, manifest.user_config.jev_quality_check]) {
      assert.equal(cfg.type, "boolean");
      assert.equal(cfg.default, true, "on by default (founder decision, 2026-09-26); the description must say what it sends");
      assert.notEqual(cfg.sensitive, true);
      assert.equal(cfg.title, "Quality check with Jev");
      assert.match(cfg.description, /sees the masked write-up/);
      assert.match(cfg.description, /zero-retention/);
      assert.match(cfg.description, /Turn off/);
    }
    assert.equal(manifest.server.mcp_config.env.GRILL_CHECK, "${user_config.jev_quality_check}");
    assert.equal(mcp.mcpServers.grill.env.GRILL_CHECK, "${user_config.jev_quality_check}");
  });

  it("both launch the same server file, which exists", () => {
    assert.equal(manifest.server.entry_point, "server/index.mjs");
    assert.deepEqual(manifest.server.mcp_config.args, ["${__dirname}/server/index.mjs"]);
    assert.deepEqual(mcp.mcpServers.grill.args, ["${CLAUDE_PLUGIN_ROOT}/server/index.mjs"]);
    assert.ok(existsSync(join(ROOT, "server/index.mjs")));
  });

  it("the extension declares exactly the tools the server serves, and a privacy policy", () => {
    assert.deepEqual(manifest.tools.map((t) => t.name), ["grill", "grill_result", "grill_look_back"]);
    assert.ok(manifest.privacy_policies.some((u) => u.includes("openrouter.ai")));
  });

  it("manifest tool names match tools/list, and the Desktop manifest has no input schemas", async () => {
    const listed = await listTools(join(ROOT, "server/index.mjs"));
    assert.deepEqual(
      manifest.tools.map((tool) => tool.name),
      listed.map((tool) => tool.name),
    );
    for (const tool of manifest.tools) assert.equal(tool.inputSchema, undefined, tool.name);
  });

  it("the Smithery bundle's tool schemas match tools/list", async () => {
    const dir = mkdtempSync(join(tmpdir(), "grill-smithery-test-"));
    try {
      const stage = join(dir, "stage");
      mkdirSync(stage);
      cpSync(join(ROOT, "manifest.json"), join(stage, "manifest.json"));
      writeFileSync(join(stage, "kept.txt"), "keep\n");
      const src = join(dir, "grill.mcpb");
      const dest = join(dir, "grill-smithery.mcpb");
      execFileSync("zip", ["-r", "-D", "-X", "-q", src, "."], { cwd: stage });
      await buildSmitheryBundle(src, dest, join(ROOT, "server/index.mjs"));
      const unpacked = join(dir, "unpacked");
      mkdirSync(unpacked);
      execFileSync("unzip", ["-q", dest, "-d", unpacked]);
      const built = JSON.parse(readFileSync(join(unpacked, "manifest.json"), "utf8"));
      const listed = await listTools(join(ROOT, "server/index.mjs"));
      assert.deepEqual(
        built.tools.map((tool) => tool.name),
        listed.map((tool) => tool.name),
      );
      for (const tool of listed) {
        const declared = built.tools.find((entry) => entry.name === tool.name);
        assert.deepEqual(declared.inputSchema, tool.inputSchema, tool.name);
        assert.equal(declared.description, manifest.tools.find((entry) => entry.name === tool.name).description);
      }
      assert.equal(readFileSync(join(unpacked, "kept.txt"), "utf8"), "keep\n");
      assert.equal(JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")).tools[0].inputSchema, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the extension build", () => {
  it("stages every file the server reaches, keeping the relative layout", () => {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-extension.mjs")], { stdio: "pipe" });
    const staged = join(ROOT, "dist/extension");
    for (const f of ["manifest.json", "server/index.mjs", "scripts/judge.mjs", "scripts/judgeCore.mjs", "scripts/checkCore.mjs", "scripts/reflection.mjs", "LICENSE"]) {
      assert.ok(existsSync(join(staged, f)), `missing ${f}`);
    }
    const server = readFileSync(join(ROOT, "server/index.mjs"), "utf8");
    assert.match(server, /new URL\("\.\.\/scripts\/judge\.mjs", import\.meta\.url\)/);
    // Every staged script's own imports too, not just the judge's: judgeCore imports checkCore,
    // and a module missing one hop down fails at install time just the same.
    for (const f of ["scripts/judge.mjs", "scripts/judgeCore.mjs", "scripts/checkCore.mjs"]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      for (const [, rel] of src.matchAll(/from "\.\/([^"]+)"/g)) {
        assert.ok(existsSync(join(staged, "scripts", rel)), `${f} imports ${rel}, which the build does not stage`);
      }
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
      grill: ["paste-prompt.md", "reflection.md"],
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

  // A grill comes back kinder than it should when the write-up leans toward the decision and
  // the judge is told that a missed flaw is the cheap mistake. These pin the guards against it.
  it("the paste-route judge is told who wrote the write-up, prices both mistakes, and runs the swap test", () => {
    const text = readFileSync(join(ROOT, "skills/grill/paste-prompt.md"), "utf8");
    assert.match(text, /The side that made this decision wrote it up/);
    assert.match(text, /tell them what you'd tell a stranger/);
    assert.match(text, /Both mistakes cost the reader/);
    assert.doesNotMatch(text, /worse than a missed one/);
    assert.match(text, /Then swap sides/);
    assert.match(text, /rules out a plain "solid"/);
    assert.match(text, /Grade severity against the decision, not the finish of the plan/);
    assert.match(text, /can be fixed in place, and makes no rejected option look better, is moderate/);
  });

  it("the grill skill writes the subject as a clerk and relays the verdict without softening it", () => {
    const text = readFileSync(join(ROOT, "skills/grill/SKILL.md"), "utf8");
    assert.match(text, /Write as a clerk, not an advocate/);
    assert.match(text, /State it and stop: don't answer it/);
    assert.match(text, /name every option, not only the chosen one/);
    assert.match(text, /\*\*The swap test\.\*\*/);
    assert.match(text, /never shorten it to "solid"/);
    assert.match(text, /no "overall, the judge agrees with you"/);
  });
});

describe("the any-assistant prompt", () => {
  const prompt = readFileSync(join(ROOT, "prompts/grill.md"), "utf8");

  it("carries the paste route's judge prompt word for word, so the two cannot drift", () => {
    const paste = readFileSync(join(ROOT, "skills/grill/paste-prompt.md"), "utf8").split("\n");
    const rules = paste.flatMap((line, i) => (line === "---" ? [i] : []));
    const judge = paste.slice(rules[0] + 1, rules.at(-1)).join("\n").trim();
    assert.ok(judge.length > 1000, "could not find the judge prompt between paste-prompt.md's rules");
    assert.ok(judge.length < 6000, "the one-tap ChatGPT link needs the judge prompt under 6,000 characters");
    assert.ok(prompt.includes(judge), "prompts/grill.md no longer contains paste-prompt.md's judge prompt");
    assert.match(judge, /^Judge: <model name> by <company>$/m);
    assert.match(judge, /Begin your answer with one line, and nothing before it/);
    assert.match(judge, /^\*\*Verdict:\*\* solid \/ solid if \/ shaky \/ doesn't hold up, and one sentence why\.$/m);
  });

  it("the home assistant notes its maker and warns when the judge is not a different company", () => {
    const skill = readFileSync(join(ROOT, "skills/grill/SKILL.md"), "utf8");
    for (const [name, text] of [
      ["prompts/grill.md", prompt],
      ["skills/grill/SKILL.md", skill],
    ]) {
      assert.match(text, /your own maker/i, `${name} does not note the assistant's maker`);
      assert.match(text, /Judge: <model name> by <company>/, `${name} does not read the Judge line`);
      assert.match(text, /NOT independent/, `${name} missing the same-company warning`);
      assert.match(text, /this verdict is unverified/, `${name} missing the missing-line warning`);
      assert.match(text, /Different company from your assistant ✓/, `${name} missing the different-company line`);
      assert.match(text, /only Gemini counts as a different company/, `${name} missing the Copilot rule`);
      assert.match(text, /ChatGPT, Gemini or Grok/, `${name} does not name assistants to paste into`);
    }
  });

  it("writes the subject as a clerk, not an advocate, in any assistant too", () => {
    assert.match(prompt, /Write the subject as a clerk, not an advocate/);
    assert.match(prompt, /Don't answer it;/);
    assert.match(prompt, /names every option/);
  });

  it("names the assistants people start from, and pairs Copilot only with a company it can't run", () => {
    for (const name of ["Claude", "ChatGPT", "Copilot", "Gemini", "Grok", "Muse"]) {
      assert.ok(prompt.includes(name), `no mention of ${name}`);
    }
    assert.match(prompt, /^\| Copilot [^\n]*\| Gemini \|$/m);
  });
});

describe("the registry listing", () => {
  const server = json("server.json");

  it("server.json names io.github.mtangoz/grill and lists GRILL_API_KEY, mentioning the other accepted name", () => {
    assert.equal(server.$schema, "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
    assert.equal(server.name, "io.github.mtangoz/grill");
    assert.equal(server.version, "0.1.1");
    assert.ok(server.description.length >= 1 && server.description.length <= 100);
    assert.equal(server.repository.url, "https://github.com/mtangoz/grill");
    assert.equal(server.repository.source, "github");
    assert.equal(server.repository.id, "1389543389");
    const pkg = server.packages[0];
    assert.equal(pkg.registryType, "mcpb");
    assert.equal(pkg.identifier, "https://github.com/mtangoz/grill/releases/download/v0.1.1/grill.mcpb");
    assert.match(pkg.identifier, /mcp/i);
    assert.equal(pkg.fileSha256, "de55a661493c44a2f476595ec5bc2e25aba78405f7e6f69b1b55e6665fa97b57");
    assert.match(pkg.fileSha256, /^[a-f0-9]{64}$/);
    assert.equal(pkg.transport.type, "stdio");
    assert.equal(pkg.registryBaseUrl, undefined);
    const env = pkg.environmentVariables[0];
    assert.equal(env.name, "GRILL_API_KEY");
    assert.equal(env.isSecret, true);
    assert.equal(env.isRequired, false);
    assert.match(env.description, /OPENROUTER_API_KEY/);
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    assert.match(readme, /GRILL_API_KEY/);
    assert.match(readme, /OPENROUTER_API_KEY/);
  });
});

describe("Glama listing files", () => {
  it("glama.json names the maintainer who can claim the listing, and the image starts the server", () => {
    const glama = json("glama.json");
    assert.equal(glama.$schema, "https://glama.ai/mcp/schemas/server.json");
    assert.deepEqual(glama.maintainers, ["mtangoz"]);
    const docker = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    assert.match(docker, /ENTRYPOINT \["node", "server\/index\.mjs"\]/);
    assert.match(docker, /^USER node$/m);
  });
});

describe("Smithery listing file", () => {
  it("smithery.yaml builds the Dockerfile, starts the server over stdio and passes each setting to its env name", () => {
    const yaml = readFileSync(join(ROOT, "smithery.yaml"), "utf8");
    assert.match(yaml, /^  dockerfile: Dockerfile$/m);
    assert.match(yaml, /^  type: stdio$/m);
    assert.match(yaml, /args: \["server\/index\.mjs"\]/);
    for (const env of ["GRILL_API_KEY", "GRILL_CHECK", "JUDGE_MODEL"]) {
      assert.ok(env in manifest.server.mcp_config.env, `${env} not in manifest.json`);
      assert.match(yaml, new RegExp(`${env}:`));
    }
    assert.equal(pkg.dependencies, undefined);
    assert.match(yaml, /Leave it blank for Grill's default, which picks a judge automatically from a different company than your assistant/);
    assert.doesNotMatch(yaml, /gemini-2\.5-pro/);
    assert.doesNotMatch(manifest.user_config.judge_model.description, /gemini-2\.5-pro/);
    assert.doesNotMatch(plugin.userConfig.judge_model.description, /gemini-2\.5-pro/);
  });
});
