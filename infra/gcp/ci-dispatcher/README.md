# Private Core CI dispatcher

This is the trusted control-plane process for private `tastile-core` CI.

It exists because the project requires both:

- zero GitHub-hosted paid runner minutes for Core heavy CI; and
- no long-lived development / CI / deploy credential outside Infisical.

## Credential flow

1. The Cloud Run Job runs as `sa-ci-dispatcher`.
2. It requests a Google-signed ID token from the metadata server with the
   Infisical machine-identity ID as the audience.
3. It exchanges that token at `/api/v1/auth/gcp-auth/login`.
4. It reads only `GITHUB_CI_APP_PRIVATE_KEY` from its permitted Infisical path.
5. It creates a GitHub App JWT in memory and exchanges it for a short-lived
   installation token.
6. The installation token is used only for Core PR discovery, source download,
   and commit-status reporting.

The private key, Infisical access token, GitHub App JWT and installation token
are never written to disk or passed into Cloud Build.

## GitHub App permissions

Install the Tastile CI GitHub App only on `tastile/tastile-core`:

- Contents: Read
- Pull requests: Read
- Commit statuses: Read & write

No webhook is configured.

## Infisical machine identity

Configure GCP Auth on a dedicated identity:

- type: `gce`
- allowed service account: `sa-ci-dispatcher@tastile-dev.iam.gserviceaccount.com`
- project/environment/path access: only the CI secret location
- secret required: `GITHUB_CI_APP_PRIVATE_KEY`

For Cloud Run, the allowed service account email is the effective GCP Auth
restriction. Infisical's allowed-project check applies only to GCE instances.
The self-hosted Free plan requires either a valid license or the bounded
development/testing overlay in ADR-0022 for custom project role assignment.
The overlay applies only to the declared development/staging evaluation projects.
Verify reads outside the CI path are denied before using a dedicated identity.
Production licensed RBAC remains a separate prerequisite.

The dispatcher uses the machine identity ID as the GCP ID-token audience,
matching Infisical's current GCP Auth verifier contract.

## Build isolation

The dispatcher uploads source to the private 7-day GCS source bucket and
submits `cloudbuild/ci.yaml` from the exact PR archive.

Cloud Build runs as `sa-cloud-build-ci`, which has no Infisical, GitHub App,
Artifact Registry write, or deployment authority.

A GCS generation-fenced lock at `locks/<head-sha>` prevents concurrent submissions.
The GitHub status context is `tastile/cloud-build-ci`.
The dispatcher accepts only the approved 30-minute timeout, Cloud Logging-only
option, and a small set of step fields from the PR archive. Source, service
account, tags, resource settings, artifacts, and destinations are fixed by the
dispatcher. Each scheduler run submits new builds and reconciles earlier builds
by the build ID in their pending GitHub status, so a queued build may outlive one
Cloud Run Job invocation. If the create response or status update was lost, the
next run recovers the build from Cloud Build tags containing the exact head SHA.
A preparation lease abandoned for five minutes can be reclaimed by generation
precondition. The owner must transition the lock to `submitting` before calling
Cloud Build. An uncertain submission is never automatically repeated, because
the create API has no idempotency key; if no build can be found for 45 minutes,
the status becomes an explicit error and a new commit can retry.
