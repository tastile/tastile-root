# GCP foundation

ms.m2-foundation の durable resources。3 environment project は operator bootstrap 後に既存であることを前提にする。

## Managed here

- required Google APIs
- runtime service-account identities (key files are never created)
- dedicated Cloud Build service accounts: `sa-cloud-build-ci` for PR CI and `sa-cloud-build-publish` for artifact publication
- shared Artifact Registry in `tastile-dev`
- GitHub Actions OIDC workload identity pools/providers with repository + ref + workflow restrictions
- Core PR Cloud Build trigger when a 2nd-gen repository resource is supplied

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

`secretmanager.googleapis.com` is enabled only in the dev control-plane project because
Cloud Build 2nd-gen GitHub connections may use provider-managed credentials internally.
Do not create Tastile-managed application/deploy secrets in GCP Secret Manager.


## Core repository connection

The GitHub App connection is the only operator-created external binding. After
connecting `tastile/tastile-core` in Cloud Build 2nd gen, pass the non-secret
resource name without editing a committed file:

```bash
export TF_VAR_core_repository_resource='projects/tastile-dev/locations/asia-northeast1/connections/<connection>/repositories/<repository>'
```

If this variable is `null`, the foundation intentionally creates no Core trigger.
When set, OpenTofu creates one pull-request trigger for target branches matching
`^release-.*$`, using `cloudbuild/ci.yaml` and `sa-cloud-build-ci`.


## Cloud Build privilege split

Pull-request build configs are controlled by the proposed commit, so PR CI must
not run with artifact/deploy authority.

- `sa-cloud-build-ci`: PR CI only. Logging Writer + project custom role containing only `cloudbuild.builds.create`.
- `sa-cloud-build-publish`: trusted image publication only. Logging Writer +
  Artifact Registry Writer on the `tastile` repository.
- The PR trigger references only `sa-cloud-build-ci`; it is never granted `roles/cloudbuild.builds.builder`.
- A future trusted publish trigger/job must reference `sa-cloud-build-publish`
  explicitly; it must never reuse the PR trigger.
