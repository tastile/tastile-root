#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { chmod, mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { KMSClient } from "@aws-sdk/client-kms";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { config, type SopsEnvConfig } from "./sops.config";

export type DecryptResult = {
  source: string;
  target: string;
  env: string;
  kmsArn: string;
  callerArn: string;
  ts: string;
  size: number;
};

export function parseArgs(argv: string[]): { env: string; check: boolean } {
  let env = process.env.TASTILE_ENV ?? "";
  let check = false;
  for (const arg of argv) {
    if (arg === "--check") check = true;
    else if (arg.startsWith("--env=")) env = arg.slice("--env=".length);
  }
  if (!env) throw die(2, "--env=<development|staging|production> or TASTILE_ENV is required");
  if (!(env in config)) throw die(2, `unknown env "${env}"; valid: ${Object.keys(config).join(", ")}`);
  return { env, check };
}

export function loadConfig(env: string): SopsEnvConfig {
  const entry = config[env];
  if (!entry) throw die(2, `config missing for env "${env}"`);
  return entry;
}

export async function assertSopsInstalled(): Promise<void> {
  const probe = spawn("sops", ["--version"], { stdio: "pipe" });
  await new Promise<void>((resolve, reject) => {
    probe.on("error", () => reject(die(2, "sops CLI not installed; see docs/runbooks/sops-install.md")));
    probe.on("exit", (code) => code === 0 ? resolve() : reject(die(2, `sops --version exited ${code}`)));
  });
}

export async function assertCredentials(region: string): Promise<string> {
  const sts = new STSClient({ region, credentials: await defaultProvider()() });
  try {
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    return identity.Arn ?? ((): never => { throw die(3, "STS returned no caller ARN"); })();
  } catch (err) {
    throw die(3, `AWS credentials unavailable: ${(err as Error).message}`);
  }
}

export function decryptOne(source: string, target: string, cfg: SopsEnvConfig, callerArn: string, cliCheck: boolean): Promise<DecryptResult> {
  return new Promise<DecryptResult>((resolvePromise, reject) => {
    const child = spawn("sops", ["--decrypt", source], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", (e) => reject(die(4, `failed to spawn sops: ${e.message}`)));
    child.on("exit", async (code) => {
      if (code !== 0) {
        return reject(die(4, `sops --decrypt ${source} exited ${code}; stderr=${Buffer.concat(err).toString()}`));
      }
      if (cfg.check || cliCheck) {
        const size = Buffer.concat(out).length;
        return resolvePromise({ source, target, env: "", kmsArn: cfg.kmsKeyArn, callerArn, ts: new Date().toISOString(), size });
      }
      try {
        await mkdir(dirname(resolve(target)), { recursive: true });
        await writeFile(resolve(target), Buffer.concat(out), { mode: 0o600 });
        await chmod(resolve(target), 0o600);
        const size = (await stat(resolve(target))).size;
        resolvePromise({ source, target, env: "", kmsArn: cfg.kmsKeyArn, callerArn, ts: new Date().toISOString(), size });
      } catch (e) {
        reject(die(6, `write ${target} failed: ${(e as Error).message}`));
      }
    });
  });
}

class SopsError extends Error {
  code: number;
  constructor(code: number, msg: string) {
    super(msg);
    this.name = "SopsError";
    this.code = code;
  }
}

function die(code: number, msg: string): SopsError {
  process.stderr.write(`[sops-decrypt] ${msg}\n`);
  return new SopsError(code, msg);
}

async function main(): Promise<void> {
  const { env, check } = parseArgs(process.argv.slice(2));
  await assertSopsInstalled();
  const cfg = loadConfig(env);
  const callerArn = await assertCredentials(cfg.awsRegion);
  // Validate KMS access once with a no-op describe (cheap, surfaces AccessDenied)
  const kms = new KMSClient({ region: cfg.awsRegion, credentials: await defaultProvider()() });
  try {
    await kms.send({ DescribeKeyCommand: undefined as never } as never); // placeholder; replaced in Task 3
  } catch { /* DescribeKey omitted in v1; rely on sops to surface Decrypt failures */ }

  const pairs = cfg.sourceFiles.map((src, i) => ({ src, dst: cfg.targetFiles[i] }));
  for (const { src, dst } of pairs) {
    const result = await decryptOne(src, dst, cfg, callerArn, check);
    result.env = env;
    process.stdout.write(JSON.stringify({ event: "decrypt", ...result }) + "\n");
  }
}

if (import.meta.main) {
  main().catch((e) => {
    const code = (e as { code?: number }).code ?? 1;
    process.stderr.write(`[sops-decrypt] fatal: ${(e as Error).message}\n`);
    process.exit(code);
  });
}
