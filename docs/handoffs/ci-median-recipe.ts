import { createHash } from "node:crypto";

export type ResolvedBuildStep = Record<string, unknown>;

export type RecipeIdentity = {
  stepsDigest: string;
  submissionStepsDigest: string;
  stepsCount: number;
  stepsDigestRelationship: string;
  submissionSteps: ResolvedBuildStep[];
};

function digest(steps: readonly ResolvedBuildStep[]): string {
  return createHash("sha256").update(JSON.stringify(steps)).digest("hex");
}

export function submissionStepsForRequest(steps: readonly ResolvedBuildStep[]): ResolvedBuildStep[] {
  return steps.map((step) => ({
    ...step,
    ...(Array.isArray(step.args)
      ? { args: step.args.map((arg) => typeof arg === "string" ? arg.replaceAll("$", () => "$$") : arg) }
      : {}),
  }));
}

export function recipeIdentity(steps: readonly ResolvedBuildStep[]): RecipeIdentity {
  const resolvedSteps = steps.map((step) => ({ ...step }));
  const submissionSteps = submissionStepsForRequest(resolvedSteps);
  return {
    stepsDigest: digest(resolvedSteps),
    submissionStepsDigest: digest(submissionSteps),
    stepsCount: resolvedSteps.length,
    stepsDigestRelationship: "stepsDigest is the resolved API recipe; submissionStepsDigest is the serialized request recipe",
    submissionSteps,
  };
}
