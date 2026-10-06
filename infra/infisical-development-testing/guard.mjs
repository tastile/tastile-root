export const binding = Object.freeze({
  organizationId: "d808df2c-ec67-4046-b733-8c0db0bfa47d",
  projectIds: Object.freeze([
    "949b4193-a226-4620-8371-726a37c7195b",
    "44081e84-5983-4cc2-9fc9-dca5363005e1",
  ]),
  productionProjectId: "ab532e90-acde-40e6-a206-3976743e5da5",
  flag: "TASTILE_INFISICAL_DEVELOPMENT_TESTING",
});

export function allowsDevelopmentTestingRbac(organizationId, scope, env = process.env) {
  return (
    env[binding.flag] === "1" &&
    !env.LICENSE_SERVER_V2_SERVICE_KEY &&
    env.INFISICAL_CLOUD !== "true" &&
    organizationId === binding.organizationId &&
    scope?.key === "projectId" &&
    scope.value !== binding.productionProjectId &&
    binding.projectIds.includes(scope.value)
  );
}
