variable "core_runtime_image" {
  description = "Verified Core candidate in the shared registry, pinned by digest. No credential values."
  type        = string
  default     = null
  nullable    = true
  validation {
    condition     = var.core_runtime_image == null ? true : can(regex("^asia-northeast1-docker.pkg.dev/tastile-dev/tastile/core@sha256:[0-9a-f]{64}$", var.core_runtime_image))
    error_message = "Core runtime must use the shared registry and an immutable sha256 digest."
  }
}

variable "core_api_enabled" {
  description = "Enable the API only after candidate rollback proof and the dedicated migration succeed."
  type        = bool
  default     = false
}

variable "core_worker_enabled" {
  description = "Enable the worker only after real delivery configuration and migration are verified."
  type        = bool
  default     = false
}

variable "worker_sweep_paused" {
  description = "Keep scheduled work paused until actual worker startup/authentication checks succeed."
  type        = bool
  default     = true
}

locals {
  core_identity = {
    api     = "d9239088-d7c7-42df-90b8-9e0c7d28ee45"
    worker  = "e781528a-742e-451a-98cf-e31279600436"
    migrate = "8b8e2905-9328-4922-afb6-dfc12beba0cc"
  }
  core_services = var.core_runtime_image == null ? {} : merge(
    var.core_api_enabled ? { api = { pool = "5", maximum = 2, arguments = ["/app/api"], ingress = "INGRESS_TRAFFIC_ALL" } } : {},
    var.core_worker_enabled ? { worker = { pool = "3", maximum = 1, arguments = ["/app/worker", "http"], ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY" } } : {}
  )
  core_selectors = {
    INFISICAL_DOMAIN      = "https://secrets.rebuildup.dev"
    INFISICAL_PROJECT_ID  = "44081e84-5983-4cc2-9fc9-dca5363005e1"
    INFISICAL_ENVIRONMENT = "staging"
  }
}

data "google_project" "staging" {
  project_id = "tastile-staging"
}

resource "google_artifact_registry_repository_iam_member" "staging_core_image_reader" {
  count      = var.core_runtime_image == null ? 0 : 1
  project    = "tastile-dev"
  location   = "asia-northeast1"
  repository = "tastile"
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:service-${data.google_project.staging.number}@serverless-robot-prod.iam.gserviceaccount.com"
}

resource "google_cloud_run_v2_service" "core" {
  for_each             = local.core_services
  project              = "tastile-staging"
  location             = "asia-northeast1"
  name                 = "core-${each.key}"
  deletion_protection  = true
  ingress              = each.value.ingress
  invoker_iam_disabled = false
  template {
    service_account                  = "sa-core-${each.key}@tastile-staging.iam.gserviceaccount.com"
    timeout                          = each.key == "worker" ? "300s" : "60s"
    max_instance_request_concurrency = each.key == "worker" ? 2 : 80
    scaling {
      min_instance_count = 0
      max_instance_count = each.value.maximum
    }
    containers {
      image   = var.core_runtime_image
      command = ["/app/infisical-bootstrap.sh"]
      args    = each.value.arguments
      ports { container_port = 8080 }
      resources {
        cpu_idle          = true
        startup_cpu_boost = false
        limits            = { cpu = "1", memory = "512Mi" }
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      dynamic "env" {
        for_each = merge(local.core_selectors, {
          INFISICAL_MACHINE_IDENTITY_ID     = local.core_identity[each.key]
          INFISICAL_SECRET_PATH             = "/tastile/core/${each.key}"
          TASTILE_ENV                       = "staging"
          TASTILE_DATABASE__MAX_CONNECTIONS = each.value.pool
          RUST_LOG                          = "info"
          }, each.key == "api" ? {
          TASTILE_API_HOST               = "0.0.0.0"
          TASTILE_ALLOWED_ORIGINS        = "https://staging-app.tastile.app"
          TASTILE_FEATURE_AVATAR_ENABLED = "false"
        } : { TASTILE_WORKER__DEADLINE_MS = "55000" })
        content {
          name  = env.key
          value = env.value
        }
      }
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance { instances = [google_sql_database_instance.staging.connection_name] }
    }
  }
  depends_on = [google_artifact_registry_repository_iam_member.staging_core_image_reader, google_project_iam_member.sql_client]
}

resource "google_cloud_run_v2_job" "core_migrate" {
  count               = var.core_runtime_image == null ? 0 : 1
  project             = "tastile-staging"
  location            = "asia-northeast1"
  name                = "core-migrate"
  deletion_protection = true
  template {
    task_count  = 1
    parallelism = 1
    template {
      service_account = "sa-core-migrate@tastile-staging.iam.gserviceaccount.com"
      timeout         = "600s"
      max_retries     = 0
      containers {
        image   = var.core_runtime_image
        command = ["/app/infisical-bootstrap.sh"]
        args    = ["/app/migrate_run"]
        resources { limits = { cpu = "1", memory = "512Mi" } }
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
        dynamic "env" {
          for_each = merge(local.core_selectors, {
            INFISICAL_MACHINE_IDENTITY_ID     = local.core_identity.migrate
            INFISICAL_SECRET_PATH             = "/tastile/core/migrate"
            TASTILE_ENV                       = "staging"
            TASTILE_DATABASE__MAX_CONNECTIONS = "2"
            RUST_LOG                          = "info"
          })
          content {
            name  = env.key
            value = env.value
          }
        }
      }
      volumes {
        name = "cloudsql"
        cloud_sql_instance { instances = [google_sql_database_instance.staging.connection_name] }
      }
    }
  }
  depends_on = [google_artifact_registry_repository_iam_member.staging_core_image_reader, google_project_iam_member.sql_client]
}

resource "google_cloud_run_v2_service_iam_member" "core_api_web" {
  count    = var.core_runtime_image != null && var.core_api_enabled ? 1 : 0
  project  = "tastile-staging"
  location = "asia-northeast1"
  name     = google_cloud_run_v2_service.core["api"].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:sa-web@tastile-staging.iam.gserviceaccount.com"
}

resource "google_cloud_run_v2_service_iam_member" "core_worker_scheduler" {
  count    = var.core_runtime_image != null && var.core_worker_enabled ? 1 : 0
  project  = "tastile-staging"
  location = "asia-northeast1"
  name     = google_cloud_run_v2_service.core["worker"].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:sa-scheduler@tastile-staging.iam.gserviceaccount.com"
}

resource "google_cloud_scheduler_job" "core_worker" {
  count            = var.core_runtime_image != null && var.core_worker_enabled ? 1 : 0
  project          = "tastile-staging"
  region           = "asia-northeast1"
  name             = "core-worker-sweep"
  description      = "Sweep durable Core work; leases and idempotency remain in PostgreSQL."
  schedule         = "* * * * *"
  time_zone        = "Etc/UTC"
  paused           = var.worker_sweep_paused
  attempt_deadline = "60s"
  retry_config {
    retry_count          = 3
    min_backoff_duration = "10s"
    max_backoff_duration = "60s"
  }
  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.core["worker"].uri}/drain"
    oidc_token {
      service_account_email = "sa-scheduler@tastile-staging.iam.gserviceaccount.com"
      audience              = google_cloud_run_v2_service.core["worker"].uri
    }
  }
  depends_on = [google_cloud_run_v2_service_iam_member.core_worker_scheduler]
}

output "core_api_uri" {
  value = try(google_cloud_run_v2_service.core["api"].uri, null)
}

output "core_worker_uri" {
  value = try(google_cloud_run_v2_service.core["worker"].uri, null)
}
