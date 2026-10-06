import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const path = process.argv[2];
const expectedHash = process.argv[3];
if (!path || !/^[0-9a-f]{64}$/.test(expectedHash ?? "")) {
  throw new Error("An exact role module path and base SHA256 are required");
}
const source = readFileSync(path, "utf8");
const actualHash = createHash("sha256").update(source).digest("hex");
if (actualHash !== expectedHash) throw new Error("Base role module SHA256 mismatch");

const membership = process.argv[4] === "membership";
if (process.argv[4] && !membership) throw new Error("Unknown patch mode");
const gate = membership ? "if (!plan?.rbac)" : "if (!plan?.rbac) {";
if (source.split(gate).length !== 3) throw new Error("Expected exactly two RBAC role gates");
const updated =
  `import { allowsDevelopmentTestingRbac } from "${membership ? "../role/" : "./"}tastile-development-testing-guard.mjs";\n` +
  source.replaceAll(
    gate,
    `if (!plan?.rbac && !allowsDevelopmentTestingRbac(dto.permission.orgId, factory.getScopeField(scopeData)))${membership ? "" : " {"}`,
  );
writeFileSync(path, updated);
console.log(`Patched exactly two ${membership ? "identity assignment" : "project role"} plan gates; actor permission guards retained`);
