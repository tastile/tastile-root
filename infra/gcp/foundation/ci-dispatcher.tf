resource "google_cloud_run_v2_job" "ci_dispatcher" {
  count = var.ci_dispatcher == null ? 0 : 1

  project             = var.projects.dev
  name                = "tastile-ci-dispatcher"
  location            = var.region
  deletion_protection = false

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account = google_service_account.ci_dispatcher.email
      max_retries     = 0
      timeout         = "2400s"

      containers {
        image = var.ci_dispatcher.image

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        env {
          name  = "INFISICAL_DOMAIN"
          value = var.ci_dispatcher.infisical_domain
        }
        env {
          name  = "INFISICAL_MACHINE_IDENTITY_ID"
          value = var.ci_dispatcher.infisical_identity_id
        }
        env {
          name  = "INFISICAL_PROJECT_ID"
          value = var.ci_dispatcher.infisical_project_id
        }
        env {
          name  = "INFISICAL_ENVIRONMENT"
          value = var.ci_dispatcher.infisical_environment
        }
        env {
          name  = "INFISICAL_SECRET_PATH"
          value = var.ci_dispatcher.infisical_secret_path
        }
        env {
          name  = "GITHUB_APP_ID"
          value = var.ci_dispatcher.github_app_id
        }
        env {
          name  = "GITHUB_INSTALLATION_ID"
          value = var.ci_dispatcher.github_installation_id
        }
        env {
          name  = "GITHUB_REPOSITORY"
          value = "tastile/tastile-core"
        }
        env {
          name  = "GCP_PROJECT_ID"
          value = var.projects.dev
        }
        env {
          name  = "GCP_REGION"
          value = var.region
        }
        env {
          name  = "CI_SOURCE_BUCKET"
          value = google_storage_bucket.ci_source.name
        }
        env {
          name  = "CLOUD_BUILD_SERVICE_ACCOUNT"
          value = google_service_account.cloud_build_ci.id
        }
      }
    }
  }

  depends_on = [
    google_project_service.enabled,
    google_project_iam_member.ci_dispatcher,
    google_service_account_iam_member.ci_dispatcher_act_as_build,
    google_storage_bucket_iam_member.ci_dispatcher_source_writer,
    google_storage_bucket_iam_member.cloud_build_ci_source_reader,
  ]
}

resource "google_cloud_run_v2_job_iam_member" "ci_dispatcher_invoker" {
  count = var.ci_dispatcher == null ? 0 : 1

  project  = var.projects.dev
  location = var.region
  name     = google_cloud_run_v2_job.ci_dispatcher[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.ci_dispatcher.email}"
}

resource "google_cloud_scheduler_job" "ci_dispatcher" {
  count = var.ci_dispatcher == null ? 0 : 1

  project          = var.projects.dev
  region           = var.region
  name             = "tastile-core-ci-dispatch"
  description      = "Poll private Core release PR heads and dispatch credential-isolated Cloud Build CI."
  schedule         = "* * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "320s"

  retry_config {
    retry_count = 0
  }

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.projects.dev}/locations/${var.region}/jobs/${google_cloud_run_v2_job.ci_dispatcher[0].name}:run"
    body        = base64encode("{}")

    headers = {
      "Content-Type" = "application/json"
    }

    oauth_token {
      service_account_email = google_service_account.ci_dispatcher.email
    }
  }

  depends_on = [
    google_project_service.enabled,
    google_cloud_run_v2_job_iam_member.ci_dispatcher_invoker,
  ]
}
