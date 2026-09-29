locals {
  environment_projects = var.projects

  enabled_services = toset([
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudtasks.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "sqladmin.googleapis.com",
    "sts.googleapis.com",
  ])

  runtime_service_accounts = toset([
    "sa-core-api",
    "sa-core-worker",
    "sa-core-migrate",
    "sa-web",
    "sa-scheduler",
  ])

  # WIF is intentionally limited to workflows that need an external GCP identity.
  # PR refs are rejected by every provider condition.
  github_identities = {
    "dev-android-poc" = {
      environment = "dev"
      account_id  = "gha-android-poc"
      repository  = "tastile/tastile-android"
      workflow    = "verify-gcp-wif.yml"
    }
    "staging-core" = {
      environment = "staging"
      account_id  = "gha-core-deploy"
      repository  = "tastile/tastile-core"
      workflow    = "deploy-staging.yml"
    }
    "production-core" = {
      environment = "production"
      account_id  = "gha-core-deploy"
      repository  = "tastile/tastile-core"
      workflow    = "deploy.yml"
    }
    "production-web" = {
      environment = "production"
      account_id  = "gha-web-deploy"
      repository  = "tastile/tastile-web"
      workflow    = "deploy.yml"
    }
    "production-android" = {
      environment = "production"
      account_id  = "gha-android-release"
      repository  = "tastile/tastile-android"
      workflow    = "release.yml"
    }
    "production-desktop" = {
      environment = "production"
      account_id  = "gha-desktop-release"
      repository  = "tastile/tastile-desktop"
      workflow    = "release.yml"
    }
  }

  api_matrix = {
    for pair in setproduct(keys(local.environment_projects), local.enabled_services) :
    "${pair[0]}:${pair[1]}" => {
      environment = pair[0]
      service     = pair[1]
      project     = local.environment_projects[pair[0]]
    }
  }

  runtime_sa_matrix = {
    for pair in setproduct(keys(local.environment_projects), local.runtime_service_accounts) :
    "${pair[0]}:${pair[1]}" => {
      environment = pair[0]
      account_id  = pair[1]
      project     = local.environment_projects[pair[0]]
    }
  }
}

data "google_project" "environment" {
  for_each   = local.environment_projects
  project_id = each.value
}

resource "google_project_service" "enabled" {
  for_each = local.api_matrix

  project            = each.value.project
  service            = each.value.service
  disable_on_destroy = false
}

resource "google_service_account" "runtime" {
  for_each = local.runtime_sa_matrix

  project      = each.value.project
  account_id   = each.value.account_id
  display_name = "Tastile ${each.value.environment} ${each.value.account_id}"

  depends_on = [google_project_service.enabled]
}

resource "google_service_account" "cloud_build" {
  project      = var.projects.dev
  account_id   = "sa-cloud-build"
  display_name = "Tastile Cloud Build"

  depends_on = [google_project_service.enabled]
}

resource "google_project_iam_member" "cloud_build_log_writer" {
  project = var.projects.dev
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.cloud_build.email}"
}

resource "google_artifact_registry_repository" "tastile" {
  project       = var.projects.dev
  location      = var.region
  repository_id = "tastile"
  description   = "Build-once OCI images promoted to Tastile staging/production by digest."
  format        = "DOCKER"

  cleanup_policy_dry_run = true

  cleanup_policies {
    id     = "delete-untagged-after-30d"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "2592000s"
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_artifact_registry_repository_iam_member" "cloud_build_writer" {
  project    = var.projects.dev
  location   = google_artifact_registry_repository.tastile.location
  repository = google_artifact_registry_repository.tastile.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.cloud_build.email}"
}

resource "google_service_account" "github" {
  for_each = local.github_identities

  project      = local.environment_projects[each.value.environment]
  account_id   = each.value.account_id
  display_name = "GitHub ${each.value.repository} ${each.value.environment}"

  depends_on = [google_project_service.enabled]
}

resource "google_iam_workload_identity_pool" "github" {
  for_each = local.github_identities

  project                   = local.environment_projects[each.value.environment]
  workload_identity_pool_id = substr(replace(each.key, "_", "-"), 0, 32)
  display_name              = "GitHub ${each.key}"
  description               = "OIDC pool restricted to ${each.value.repository} / ${each.value.workflow}."

  depends_on = [google_project_service.enabled]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  for_each = local.github_identities

  project                            = local.environment_projects[each.value.environment]
  workload_identity_pool_id          = google_iam_workload_identity_pool.github[each.key].workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub Actions"

  attribute_mapping = {
    "google.subject"           = "assertion.sub"
    "attribute.repository"     = "assertion.repository"
    "attribute.repository_owner" = "assertion.repository_owner"
    "attribute.ref"            = "assertion.ref"
    "attribute.workflow_ref"   = "assertion.workflow_ref"
  }

  # PR refs cannot authenticate. The exact workflow file is pinned as well as
  # repository owner/repository to avoid trusting arbitrary workflows.
  attribute_condition = <<-CEL
    assertion.repository_owner == "tastile" &&
    assertion.repository == "${each.value.repository}" &&
    (assertion.ref.startsWith("refs/heads/release-") || assertion.ref.startsWith("refs/tags/v")) &&
    (
      assertion.workflow_ref.startsWith("${each.value.repository}/.github/workflows/${each.value.workflow}@refs/heads/release-") ||
      assertion.workflow_ref.startsWith("${each.value.repository}/.github/workflows/${each.value.workflow}@refs/tags/v")
    )
  CEL

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com/"
  }
}

resource "google_service_account_iam_member" "github_wif" {
  for_each = local.github_identities

  service_account_id = google_service_account.github[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github[each.key].name}/attribute.repository/${each.value.repository}"
}

# Metadata only. No secret version/value is ever placed in OpenTofu state.
resource "google_secret_manager_secret" "wif_probe" {
  project   = var.projects.dev
  secret_id = "poc-wif-probe"

  replication {
    auto {}
  }

  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_iam_member" "wif_probe_android_only" {
  project   = var.projects.dev
  secret_id = google_secret_manager_secret.wif_probe.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.github["dev-android-poc"].email}"
}
