import { expect, test } from "bun:test";
import { recipeIdentity, submissionStepsForRequest } from "./ci-median-recipe";

test("normalizes resolved shell dollars only for the Cloud Build request", () => {
  const resolved = [{ id: "rust-quality", args: ["$${CARGO_TARGET_DIR}", "$$literal"] }];
  const submission = submissionStepsForRequest(resolved);

  expect(resolved[0]?.args).toEqual(["$${CARGO_TARGET_DIR}", "$$literal"]);
  expect(submission[0]?.args).toEqual(["$$$${CARGO_TARGET_DIR}", "$$$$literal"]);
});

test("records resolved recipe identity, submission identity, and exact step count", () => {
  const resolved = [{ id: "postgres-start" }, { id: "rust-quality", args: ["$${CARGO_TARGET_DIR}"] }];
  const recipe = recipeIdentity(resolved);

  expect(recipe.stepsDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(recipe.submissionStepsDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(recipe.stepsDigest).not.toBe(recipe.submissionStepsDigest);
  expect(recipe.stepsCount).toBe(2);
  expect(recipe.stepsDigestRelationship).toContain("resolved API recipe");
});
