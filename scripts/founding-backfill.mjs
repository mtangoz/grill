#!/usr/bin/env node
/**
 * Number people already let in, oldest first access first.
 * First access is the earliest of an account createdAt and a waitlist approvedAt.
 * Tony's addresses are --exclude arguments. They are not stored in this repository.
 *
 *   node scripts/founding-backfill.mjs --file people.json --exclude person@example.com
 *   node scripts/founding-backfill.mjs --file people.json --exclude person@example.com --apply
 *
 * people.json is an array of { "email", "at" }. at is an ISO time, or omitted.
 * Without --apply this prints the order and writes nothing.
 */
import { readFileSync } from "node:fs";
import { redisCommand } from "../api/_account.mjs";
import { backfillFoundingMembers, foundingBackfillOrder } from "../api/_founding.mjs";

function argsOf(argv) {
  const exclude = [];
  let file = "";
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--file") {
      file = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg === "--exclude") {
      const value = argv[i + 1] || "";
      i += 1;
      for (const email of value.split(",")) {
        if (email.trim()) exclude.push(email.trim());
      }
      continue;
    }
    throw new Error(`unknown argument ${arg}`);
  }
  if (!file) throw new Error("--file is required");
  return { file, exclude, apply };
}

function readPeople(file) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("people file must be an array");
  return parsed.map((row) => ({ email: row?.email, at: row?.at }));
}

function printOrder(ordered) {
  if (!ordered.length) {
    process.stdout.write("No one to number.\n");
    return;
  }
  ordered.forEach((row, index) => {
    process.stdout.write(`${row.email} #${index + 1}\n`);
  });
}

async function main() {
  const { file, exclude, apply } = argsOf(process.argv.slice(2));
  const people = readPeople(file);
  const ordered = foundingBackfillOrder(people, exclude);
  printOrder(ordered);
  if (!apply) {
    process.stdout.write("Wrote nothing.\n");
    return;
  }
  const env = process.env;
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    process.stderr.write("not configured\n");
    process.exitCode = 2;
    return;
  }
  const assigned = await backfillFoundingMembers(redisCommand(env), people, exclude);
  for (const row of assigned) {
    process.stdout.write(`${row.email} ${row.ok ? `#${row.number}` : row.reason}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
