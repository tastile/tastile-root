# GCP foundation

ms.m2-foundation の durable resources。3 environment project は operator bootstrap 後に既存であることを前提にする。

## Managed here

- required Google APIs
- runtime service-account identities (key files are never created)
- dedicated Cloud Build service accounts: `sa-cloud-build-ci` for PR CI and `sa-cloud-build-publish` for artifact publication
- shared Artifact Registry in `tastile-dev`
- GitHub Actions OIDC workload identity pools/providers with repository + ref + workflow restrictions
- private Core CI dispatcher identity + private ephemeral source bucket

The Artifact Registry / Cloud Build control plane intentionally lives in the dev project. Production/staging runtime identities receive only the
specific read/deploy grants added by later environment stacks; CI does not gain broad production project permissions.

## State

State is stored in the bootstrap-created private GCS bucket in the dev project. The state contains infrastructure metadata and IAM bindings;
secret values are prohibited.

```bash
tofu init \
  -backend-config="bucket=${TASTILE_GCP_DEV_PROJECT:-tastile-dev}-tastile-tofu-state" \
  -backend-config="prefix=foundation"

tofu fmt -check -recursive
tofu validate
tofu plan
```

`operator-bootstrap.sh --apply` creates the local, gitignored `foundation.auto.tfvars.json`.

## Workload identity policy

GCP WIF in this foundation is for **GCP control-plane access only** (deploy / publish).
It is not the application-secret delivery path.

Every provider pins:

- organization = `tastile`
- exact repository + numeric repository ID
- release branch or `v*` tag
- exact workflow file

Tastile-managed secret values remain canonical in Infisical (ADR-0015).
GitHub Actions that need those values authenticate directly to Infisical with OIDC.
Cloud Run services/jobs authenticate to Infisical with GCP-native workload identity.

The private Core CI path deliberately does **not** use a Cloud Build GitHub connection.
The Tastile GitHub App private key is stored only in Infisical; a GCP workload-authenticated
dispatcher mints short-lived installation tokens, downloads the requested Core commit,
uploads a source archive to the private 7-day GCS source bucket, submits Cloud Build, and
reports status to GitHub. GCP Secret Manager is not enabled by this foundation.


## Cloud Build privilege split

Pull-request build configs are controlled by the proposed commit, so PR CI must
not run with artifact/deploy authority.

- `sa-ci-dispatcher`: trusted dispatcher runtime. May create/get Cloud Builds, upload
  source objects, and act as `sa-cloud-build-ci`; no Artifact Registry / deploy rights.
- `sa-cloud-build-ci`: untrusted PR build execution. Logging Writer + source-bucket read only.
- `sa-cloud-build-publish`: trusted image publication only. Logging Writer +
  Artifact Registry Writer on the `tastile` repository.
- GitHub App private material is never available to `sa-cloud-build-ci` or PR code.


## Private Core CI authentication

Private Core CI is intentionally decoupled from Cloud Build's GitHub App connection.

1. Cloud Scheduler invokes the trusted CI dispatcher using IAM.
2. The dispatcher authenticates to Infisical with its GCP service account identity.
3. Infisical injects the Tastile CI GitHub App private key.
4. The dispatcher mints a short-lived GitHub installation token, polls open Core PRs
   targeting `release-*`, and marks a commit status as pending before submitting work.
5. Source is downloaded by the dispatcher and uploaded to the private CI source bucket.
6. Cloud Build executes the source as `sa-cloud-build-ci`, which cannot read Infisical,
   mutate Artifact Registry, or deploy.
7. The dispatcher observes the build and posts the final GitHub commit status.

The GitHub App ID / installation ID and Infisical machine identity/project identifiers
are non-secret references. The GitHub App private key is an Infisical secret and has no
second editable copy.
