// Formats a dossier JSON in the house style: objects whose values are all
// primitives are written inline on one line; everything else is expanded.
import { readFileSync, writeFileSync } from "node:fs";

const isFlat = (v) =>
  v && typeof v === "object" && !Array.isArray(v) &&
  Object.values(v).every((x) => x === null || typeof x !== "object");

function fmt(v, indent) {
  const pad = "  ".repeat(indent);
  const inner = "  ".repeat(indent + 1);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return "[\n" + v.map((x) => inner + fmt(x, indent + 1)).join(",\n") + "\n" + pad + "]";
  }
  if (v && typeof v === "object") {
    const entries = Object.entries(v);
    if (entries.length === 0) return "{}";
    if (isFlat(v)) {
      return "{ " + entries.map(([k, x]) => JSON.stringify(k) + ": " + JSON.stringify(x)).join(", ") + " }";
    }
    return "{\n" + entries.map(([k, x]) => inner + JSON.stringify(k) + ": " + fmt(x, indent + 1)).join(",\n") + "\n" + pad + "}";
  }
  return JSON.stringify(v);
}

for (const path of process.argv.slice(2)) {
  writeFileSync(path, fmt(JSON.parse(readFileSync(path, "utf8")), 0) + "\n");
  console.log("formatted " + path);
}
