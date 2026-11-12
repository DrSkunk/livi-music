import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";

async function writeConfig() {
  const { LIVI_MUSIC_ICE_SERVERS: iceServers } = process.env;
  if (!iceServers) return copyFile("config.js", "dist/config.js");
  const config = { iceServers: [] };
  if (iceServers) {
    config.iceServers = JSON.parse(iceServers);
    if (!Array.isArray(config.iceServers)) throw new Error("LIVI_MUSIC_ICE_SERVERS must be a JSON array");
  }
  const body = `// Generated at build time. This file is public.\nwindow.LIVI_MUSIC_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
  return writeFile("dist/config.js", body);
}

await mkdir("dist", { recursive: true });
await Promise.all([
  ...["index.html", "style.css"].map((file) => copyFile(file, `dist/${file}`)),
  writeConfig(),
  copyFile("node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", "dist/inter.woff2"),
  copyFile("node_modules/@fontsource-variable/inter/LICENSE", "dist/INTER-LICENSE"),
]);

const results = await Promise.all([
  build({
    entryPoints: ["app.js"],
    outfile: "dist/app.js",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "linked",
    metafile: true,
  }),
  build({
    entryPoints: ["metadata.js"],
    outfile: "dist/metadata.bundle.js",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "linked",
    metafile: true,
  }),
]);
const packages = new Set();
for (const result of results) {
  for (const input of Object.keys(result.metafile.inputs)) {
    const parts = input.split("/");
    if (parts[0] !== "node_modules") continue;
    packages.add(parts[1].startsWith("@") ? `${parts[1]}/${parts[2]}` : parts[1]);
  }
}
const notices = [];
for (const name of [...packages].sort()) {
  const directory = join("node_modules", name);
  const filename = (await readdir(directory)).find((file) => /^licen[cs]e(?:\..*)?$/i.test(file));
  if (!filename) throw new Error(`Missing bundled dependency license: ${name}`);
  notices.push(`${name}\n\n${await readFile(join(directory, filename), "utf8")}`);
}
await writeFile("dist/THIRD-PARTY-NOTICES.txt", notices.join("\n\n---\n\n"));
