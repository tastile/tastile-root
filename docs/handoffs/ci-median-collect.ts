// Archived PoC helper for this handoff; execute from the workspace root.
import { recipeIdentity } from './ci-median-recipe';
const cohort = await Bun.file('.tmp/ci-median-builds.json').json();
if (cohort.builds.length !== 10 || new Set(cohort.builds.map((b: any) => b.id)).size !== 10) throw Error('Ten distinct planned samples required');
const auth = Bun.spawnSync((process.platform === 'win32' ? ['pwsh', '-NoProfile', '-File', 'C:/Users/rebui/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'] : ['gcloud','auth','print-access-token']));
if (auth.exitCode) throw Error('GCP auth failed');
const headers = { Authorization: `Bearer ${auth.stdout.toString().trim()}`, 'Content-Type': 'application/json' };
const root = 'https://cloudbuild.googleapis.com/v1/projects/tastile-dev/locations/asia-northeast1/builds/';
const allowed = ['name', 'id', 'args', 'entrypoint', 'env', 'dir', 'volumes', 'waitFor', 'timeout'];
const observations = await Promise.all(cohort.builds.map(async (sample: any) => {
  const response = await fetch(root + sample.id, { headers });
  if (!response.ok) throw Error(`Sample ${sample.sample} HTTP${response.status}`);
  const b: any = await response.json();
  const steps = b.steps.map((s: any) => Object.fromEntries(allowed.filter(k => s[k] !== undefined).map(k => [k, s[k]])));
  const recipe = recipeIdentity(steps);
  if (recipe.stepsDigest !== cohort.stepsDigest || (cohort.submissionStepsDigest && recipe.submissionStepsDigest !== cohort.submissionStepsDigest) || (cohort.stepsCount !== undefined && recipe.stepsCount !== cohort.stepsCount) || ['bucket','object','generation'].some(k => b.source?.storageSource?.[k] !== cohort.source.storageSource[k]) || b.serviceAccount !== 'projects/tastile-dev/serviceAccounts/sa-cloud-build-ci@tastile-dev.iam.gserviceaccount.com') throw Error(`Sample ${sample.sample} cohort mismatch`);
  if (b.timeout !== '1800s' || b.options?.logging !== 'CLOUD_LOGGING_ONLY' || b.options?.pool?.name || b.availableSecrets || b.secrets?.length || b.steps.some((s: any) => s.secretEnv?.length)) throw Error('Unexpected runtime trust/recipe options');
  if (b.options?.machineType && b.options.machineType !== 'E2_STANDARD_2') throw Error('Unexpected machine type');
  return { sample: sample.sample, id: b.id, status: b.status, allStepsSuccess: b.steps.every((s: any) => s.status === 'SUCCESS'), startTime: b.startTime, finishTime: b.finishTime, seconds: b.finishTime ? (Date.parse(b.finishTime) - Date.parse(b.startTime)) / 1000 : null, images: b.results?.buildStepImages ?? [], stepsCount: recipe.stepsCount, submissionStepsDigest: recipe.submissionStepsDigest };
}));
const terminalFailures = observations.filter((b: any) => ['FAILURE', 'TIMEOUT', 'CANCELLED', 'EXPIRED', 'INTERNAL_ERROR'].includes(b.status));
const baselineObservation = observations.find((b: any) => b.sample === 1);
const expectedStepsCount = cohort.stepsCount ?? baselineObservation?.stepsCount;
const submissionStepsDigest = cohort.submissionStepsDigest ?? baselineObservation?.submissionStepsDigest;
if (expectedStepsCount === undefined || !Number.isInteger(expectedStepsCount) || expectedStepsCount <= 0) throw Error('Resolved baseline step count is missing');
await Bun.write('.tmp/ci-median-observations.json', JSON.stringify({ observedAt: new Date().toISOString(), sha: cohort.sha, stepsDigest: cohort.stepsDigest, submissionStepsDigest, stepsCount: expectedStepsCount, stepsDigestRelationship: cohort.stepsDigestRelationship ?? 'stepsDigest is the resolved API recipe; submissionStepsDigest is the serialized request recipe', observations, terminalFailures, medianSeconds: null }, null, 2) + '\n');
if (terminalFailures.length) { console.log(JSON.stringify({ verdict: 'failed', terminalFailures })); process.exit(1); }
if (observations.some((b: any) => b.status !== 'SUCCESS')) { console.log(JSON.stringify({ verdict: 'pending', statuses: observations.map((b: any) => ({ sample: b.sample, status: b.status })) })); process.exit(2); }
if (observations.some((b: any) => !b.allStepsSuccess || !(b.seconds > 0) || b.stepsCount !== expectedStepsCount || b.images.length !== expectedStepsCount)) throw Error('Successful build and every step/digest required');
if (new Set(observations.map((b: any) => JSON.stringify(b.images))).size !== 1) throw Error('Build image digests changed within cohort');
if (cohort.builds[0].id !== cohort.baselineId || cohort.builds[0].origin !== 'automatic-dispatcher' || cohort.builds.some((b: any, i: number) => b.sample !== i + 1)) throw Error('Automatic sample1 and ordered samples2-10 required');
const counts = [];let expectedGroups: number | undefined;let expectedPassed: number | undefined;
for (const build of observations) {
  let pageToken: string | undefined; const results: string[] = [];
  do {
    const response = await fetch('https://logging.googleapis.com/v2/entries:list', { method: 'POST', headers, body: JSON.stringify({ resourceNames: ['projects/tastile-dev'], filter: `resource.type="build" AND resource.labels.build_id="${build.id}" AND textPayload:"test result:"`, orderBy: 'timestamp asc', pageSize: 1000, pageToken }) });
    if (!response.ok) throw Error(`Test log HTTP${response.status}`);
    const j: any = await response.json();
    for (const entry of j.entries ?? []) { const match = entry.textPayload?.match(/test result: .*?\d+ passed; \d+ failed; \d+ ignored[^\n]*/); if (match) results.push(match[0]); }
    pageToken = j.nextPageToken;
  } while (pageToken);
  let passed = 0, failed = 0, ignored = 0;
  for (const line of results) { const m = line.match(/(\d+) passed; (\d+) failed; (\d+) ignored/)!; passed += +m[1]; failed += +m[2]; ignored += +m[3]; }
  if (build.sample === 1) { if (!results.length || !passed || failed || ignored) throw Error('Successful automatic baseline full-test proof required');expectedGroups = results.length;expectedPassed = passed; }
  if (results.length !== expectedGroups || passed !== expectedPassed || failed || ignored) throw Error(`Sample ${build.sample} full-test proof mismatch`);
  counts.push({ id: build.id, groups: results.length, passed, failed, ignored });
}
const sorted = observations.map((b: any) => b.seconds).sort((a: number, b: number) => a - b);
const medianSeconds = (sorted[4] + sorted[5]) / 2;
const result = { observedAt: new Date().toISOString(), sha: cohort.sha, source: cohort.source, stepsDigest: cohort.stepsDigest, resolvedStepsDigest: cohort.stepsDigest, submissionStepsDigest, stepsCount: expectedStepsCount, stepsDigestRelationship: cohort.stepsDigestRelationship ?? 'stepsDigest is the resolved API recipe; submissionStepsDigest is the serialized request recipe', observations, counts, medianSeconds, medianMinutes: medianSeconds / 60, durationCriterionPassed: medianSeconds <= 1500, monthlyMinutesAt40Runs: 40 * medianSeconds / 60, monthlyMinutesCriterionPassed: 40 * medianSeconds / 60 <= 1000, expectedGroups, expectedPassed, computeEstimateUsdBeforeCredits: sorted.reduce((sum: number, seconds: number) => sum + seconds / 60 * 0.006, 0), costIsActualInvoice: false };
await Bun.write('.tmp/ci-median-final.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ verdict: result.durationCriterionPassed && result.monthlyMinutesCriterionPassed ? 'duration-pass' : 'duration-fail', medianSeconds, medianMinutes: result.medianMinutes }));
process.exitCode = result.durationCriterionPassed && result.monthlyMinutesCriterionPassed ? 0 : 1;
