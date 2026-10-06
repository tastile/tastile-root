import { describe, expect, test } from "bun:test";
import { allowsDevelopmentTestingRbac, binding } from "./guard.mjs";

const enabled = { [binding.flag]: "1" };
const dev = { key: "projectId", value: binding.projectIds[0] };

describe("development/testing project RBAC scope", () => {
  test("only the exact explicit flag enables an exception", () => {
    for (const value of [undefined, "", "0", "true", "01", "1 ", 1]) {
      expect(allowsDevelopmentTestingRbac(binding.organizationId, dev, { [binding.flag]: value })).toBe(false);
    }
  });

  test("allows the two evaluation projects", () => {
    for (const value of binding.projectIds) {
      expect(allowsDevelopmentTestingRbac(binding.organizationId, { key: "projectId", value }, enabled)).toBe(true);
    }
  });

  test("rejects production and foreign projects", () => {
    for (const value of [binding.productionProjectId, "foreign-project", undefined]) {
      expect(allowsDevelopmentTestingRbac(binding.organizationId, { key: "projectId", value }, enabled)).toBe(false);
    }
  });

  test("rejects organization scope and malformed scope", () => {
    for (const scope of [{ key: "orgId", value: binding.organizationId }, {}, null]) {
      expect(allowsDevelopmentTestingRbac(binding.organizationId, scope, enabled)).toBe(false);
    }
  });

  test("rejects foreign organizations", () => {
    expect(allowsDevelopmentTestingRbac("foreign-org", dev, enabled)).toBe(false);
  });

  test("rejects cloud deployment flags", () => {
    expect(allowsDevelopmentTestingRbac(binding.organizationId, dev, { ...enabled, INFISICAL_CLOUD: "true" })).toBe(false);
    expect(allowsDevelopmentTestingRbac(binding.organizationId, dev, { ...enabled, LICENSE_SERVER_V2_SERVICE_KEY: "test-present" })).toBe(false);
  });

  test("implementation bindings match the canonical security control", async () => {
    const model = Bun.YAML.parse(await Bun.file("architecture/model/security.yaml").text()) as {
      controls: { id: string; rule: string }[];
    };
    const rule = model.controls.find((control) => control.id === "ctl.infisical-development-testing")?.rule;
    for (const value of [binding.organizationId, ...binding.projectIds, binding.productionProjectId, binding.flag]) {
      expect(rule).toContain(value);
    }
  });
});
