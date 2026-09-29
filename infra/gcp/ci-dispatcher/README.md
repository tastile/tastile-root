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
- allowed project: `tastile-dev`
- project/environment/path access: only the CI secret location
- secret required: `GITHUB_CI_APP_PRIVATE_KEY`

The dispatcher uses the machine identity ID as the GCP ID-token audience,
matching Infisical's current GCP Auth verifier contract.

## Build isolation

The dispatcher uploads source to the private 7-day GCS source bucket and
submits `cloudbuild/ci.yaml` from the exact PR archive.

Cloud Build runs as `sa-cloud-build-ci`, which has no Infisical, GitHub App,
Artifact Registry write, or deployment authority.

A GCS create-only lock at `locks/<head-sha>` fences duplicate submissions.
The GitHub status context is `tastile/cloud-build-ci`.
