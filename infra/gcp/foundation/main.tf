locals {
  environment_projects = var.projects

  common_services = toset([
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "serviceusage.googleapis.com",
    "sts.googleapis.com",
  ])

  environment_services = {
    dev = setunion(local.common_services, toset([
      "artifactregistry.googleapis.com",
      "billingbudgets.googleapis.com",
      "cloudbilling.googleapis.com",
      "cloudbuild.googleapis.com",
      "cloudscheduler.googleapis.com",
      "run.googleapis.com",
      "storage.googleapis.com",
    ]))
    staging = setunion(local.common_services, toset([
      "cloudscheduler.googleapis.com",
      "run.googleapis.com",
      "sqladmin.googleapis.com",
    ]))
    production = setunion(local.common_services, toset([
      "cloudscheduler.googleapis.com",
      "run.googleapis.com",
      "sqladmin.googleapis.com",
    ]))
  }

  runtime_environments = toset(["staging", "production"])

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
    "staging-core" = {
      environment = "staging"
      account_id  = "gha-core-deploy"
      repository   = "tastile/tastile-core"
      repository_id = "1180525566"
      workflow     = "deploy-staging.yml"
    }
    "production-core" = {
      environment = "production"
      account_id  = "gha-core-deploy"
      repository   = "tastile/tastile-core"
      repository_id = "1180525566"
      workflow     = "deploy.yml"
    }
    "production-web" = {
      environment = "production"
      account_id  = "gha-web-deploy"
      repository   = "tastile/tastile-web"
      repository_id = "1180525602"
      workflow     = "deploy.yml"
    }
    "production-android" = {
      environment = "production"
      account_id  = "gha-android-release"
      repository   = "tastile/tastile-android"
      repository_id = "1180525654"
      workflow     = "release.yml"
    }
    "production-desktop" = {
      environment = "production"
      account_id  = "gha-desktop-release"
      repository   = "tastile/tastile-desktop"
      repository_id = "1180525633"
      workflow     = "release.yml"
    }
  }

  api_matrix = {
    for item in flatten([
      for environment, services in local.environment_services : [
        for service in services : {
          key         = "${environment}:${service}"
          environment = environment
          service     = service
          project     = local.environment_projects[environment]
        }
      ]
    ]) : item.key => item
  }

  runtime_sa_matrix = {
    for pair in setproduct(local.runtime_environments, local.runtime_service_accounts) :
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

resource "google_service_account" "cloud_build_ci" {
  project      = var.projects.dev
  account_id   = "sa-cloud-build-ci"
  display_name = "Tastile Cloud Build PR CI"

  depends_on = [google_project_service.enabled]
}

resource "google_service_account" "cloud_build_publish" {
  project      = var.projects.dev
  account_id   = "sa-cloud-build-publish"
  display_name = "Tastile Cloud Build artifact publisher"

  depends_on = [google_project_service.enabled]
}

resource "google_service_account" "ci_dispatcher" {
  project      = var.projects.dev
  account_id   = "sa-ci-dispatcher"
  display_name = "Tastile private CI dispatcher"

  depends_on = [google_project_service.enabled]
}

resource "google_project_iam_member" "cloud_build_ci_log_writer" {
  project = var.projects.dev
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.cloud_build_ci.email}"
}

resource "google_project_iam_custom_role" "ci_dispatcher" {
  project     = var.projects.dev
  role_id     = "tastileCiDispatcher"
  title       = "Tastile private CI dispatcher"
  description = "Submit and observe Cloud Build runs without deploy/artifact privileges."
  permissions = [
    "cloudbuild.builds.create",
    "cloudbuild.builds.get",
    "serviceusage.services.use",
  ]

  depends_on = [google_project_service.enabled]
}

resource "google_project_iam_member" "ci_dispatcher" {
  project = var.projects.dev
  role    = google_project_iam_custom_role.ci_dispatcher.name
  member  = "serviceAccount:${google_service_account.ci_dispatcher.email}"
}

resource "google_service_account_iam_member" "ci_dispatcher_act_as_build" {
  service_account_id = google_service_account.cloud_build_ci.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.ci_dispatcher.email}"
}

resource "google_project_iam_member" "cloud_build_publish_log_writer" {
  project = var.projects.dev
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.cloud_build_publish.email}"
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
  member     = "serviceAccount:${google_service_account.cloud_build_publish.email}"
}

resource "google_storage_bucket" "ci_source" {
  project                     = var.projects.dev
  name                        = "${var.projects.dev}-tastile-ci-source"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_storage_bucket_iam_member" "ci_dispatcher_source_writer" {
  bucket = google_storage_bucket.ci_source.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.ci_dispatcher.email}"
}

resource "google_storage_bucket_iam_member" "cloud_build_ci_source_reader" {
  bucket = google_storage_bucket.ci_source.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.cloud_build_ci.email}"
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
    "attribute.repository_owner"    = "assertion.repository_owner"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.ref"                 = "assertion.ref"
    "attribute.workflow_ref"   = "assertion.workflow_ref"
  }

  # PR refs cannot authenticate. The exact workflow file is pinned as well as
  # repository owner/repository to avoid trusting arbitrary workflows.
  attribute_condition = <<-CEL
    assertion.repository_owner == "tastile" &&
    assertion.repository_owner_id == "267846510" &&
    assertion.repository == "${each.value.repository}" &&
    assertion.repository_id == "${each.value.repository_id}" &&
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

