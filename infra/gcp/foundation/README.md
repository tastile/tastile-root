# GCP foundation

ms.m2-foundation の durable resources。3 environment project は operator bootstrap 後に既存であることを前提にする。

## Managed here

- required Google APIs
- runtime service-account identities (key files are never created)
- split Cloud Build identities: `sa-cloud-build-ci` (PR CI, logging only) and `sa-cloud-build-publish` (artifact publishing)
- shared Artifact Registry in `tastile-dev`
- GitHub Actions OIDC workload identity pools/providers with repository + ref + workflow restrictions
- WIF PoC secret **metadata** only
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

## WIF policy

Every provider rejects pull-request refs and pins:

- organization = `tastile`
- exact repository
- release branch or `v*` tag
- exact workflow file

The dev-only `dev-android-poc` identity is reserved for `poc.secret-manager-wif`; it may read only the `poc-wif-probe` secret.
Other repository identities must fail that read.

Application secret names and values are **not** declared here. They are created from the owning service's runtime-config contract in ms.m3/m4.


## Core repository connection

The GitHub App connection is the only operator-created external binding. After
connecting `tastile/tastile-core` in Cloud Build 2nd gen, pass the non-secret
resource name without editing a committed file:

```bash
export TF_VAR_core_repository_resource='projects/tastile-dev/locations/asia-northeast1/connections/<connection>/repositories/<repository>'
```

If this variable is `null`, the foundation intentionally creates no Core trigger.
When set, OpenTofu creates one pull-request trigger for target branches matching
`^release-.*$`, using `cloudbuild/ci.yaml` and the unprivileged `sa-cloud-build-ci`. The publish identity is not attached to pull-request triggers.


## Cloud Build privilege split

Pull-request source is untrusted build input even in a private repository. The PR
trigger therefore runs as `sa-cloud-build-ci`, which receives only Cloud Logging
write access from this stack. It cannot write Artifact Registry or read application
secrets.

`sa-cloud-build-publish` owns Artifact Registry writer access and is reserved for
release/image-build triggers added after the build-once promotion flow is implemented.
