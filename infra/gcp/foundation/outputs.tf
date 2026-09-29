output "artifact_registry" {
  value = "${var.region}-docker.pkg.dev/${var.projects.dev}/${google_artifact_registry_repository.tastile.repository_id}"
}

output "cloud_build_service_accounts" {
  value = {
    ci      = google_service_account.cloud_build_ci.email
    publish = google_service_account.cloud_build_publish.email
  }
}

output "runtime_service_accounts" {
  value = {
    for key, account in google_service_account.runtime :
    key => account.email
  }
}

output "github_wif" {
  value = {
    for key, provider in google_iam_workload_identity_pool_provider.github :
    key => {
      provider_resource = provider.name
      service_account   = google_service_account.github[key].email
    }
  }
}

output "wif_probe_secret" {
  value = google_secret_manager_secret.wif_probe.id
}

output "ci_dispatcher" {
  value = {
    service_account = google_service_account.ci_dispatcher.email
    source_bucket   = google_storage_bucket.ci_source.name
  }
}
