// Case registry: contract case id -> implementation.
// The runner verifies this registry covers every contract case exactly.

import type { RunContext } from "../ctx.ts";
import { at01, at16 } from "./edge.ts";
import { at03, at04 } from "./auth.ts";
import { at05, at06, at07, at08, at11, at12 } from "./api.ts";
import { at09 } from "./placement.ts";
import { at10 } from "./convergence.ts";
import { at02 } from "./web.ts";
import { at13, at14, at15 } from "./ops.ts";
import { at17 } from "./audit.ts";
import { coreE2E } from "./core-e2e.ts";

export type CaseImpl = (ctx: RunContext) => Promise<void>;

export const CASES: Record<string, CaseImpl> = {
  "A-AT01": at01,
  "A-AT02": at02,
  "A-AT03": at03,
  "A-AT04": at04,
  "A-AT05": at05,
  "A-AT06": at06,
  "A-AT07": at07,
  "A-AT08": at08,
  "A-AT09": at09,
  "A-AT10": at10,
  "A-AT11": at11,
  "A-AT12": at12,
  "A-AT13": at13,
  "A-AT14": at14,
  "A-AT15": at15,
  "A-AT16": at16,
  "A-AT17": at17,
  "A-E2E-CORE": coreE2E,
};
