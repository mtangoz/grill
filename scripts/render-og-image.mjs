#!/usr/bin/env node
/**
 * Render site/brand/og-image.svg to site/brand/og-image.png (1200×630).
 * The pitchfork is a path in the SVG. The type is Inter (SIL OFL), subsetted
 * into scripts/fonts/ so a re-render does not depend on which fonts the machine has.
 *
 *   npm install
 *   node scripts/render-og-image.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let Resvg;
try {
  ({ Resvg } = await import("@resvg/resvg-js"));
} catch (err) {
  console.error("Install the dev dependency first: npm install");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = join(ROOT, "site/brand/og-image.svg");
const pngPath = join(ROOT, "site/brand/og-image.png");
const svg = readFileSync(svgPath);
const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: 1200 },
  font: {
    fontFiles: ["Regular", "Medium", "SemiBold"].map((weight) => join(ROOT, "scripts/fonts", `Inter-${weight}.subset.ttf`)),
    loadSystemFonts: false,
    defaultFontFamily: "Inter",
  },
});
const png = resvg.render().asPng();
if (png.subarray(0, 8).toString("latin1") !== "\x89PNG\r\n\x1a\n" || png.subarray(12, 16).toString("ascii") !== "IHDR") {
  throw new Error("renderer did not write a PNG");
}
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (width !== 1200 || height !== 630) throw new Error(`expected 1200x630, got ${width}x${height}`);
writeFileSync(pngPath, png);
console.log(`wrote site/brand/og-image.png ${width}x${height}`);
