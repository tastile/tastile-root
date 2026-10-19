variable "web_runtime_image" {
  description = "Verified Web candidate in the shared registry, pinned by digest. No credential values."
  type        = string
  default     = null
  nullable    = true
  validation {
    condition     = var.web_runtime_image == null ? true : can(regex("^asia-northeast1-docker.pkg.dev/tastile-dev/tastile/web@sha256:[0-9a-f]{64}$", var.web_runtime_image))
    error_message = "Web runtime must use the shared registry and an immutable sha256 digest."
  }
}

variable "web_identity_id" {
  description = "Infisical machine identity bound to sa-web (gcp-auth, staging /tastile/web/runtime read)."
  type        = string
  default     = null
  nullable    = true
}

variable "web_public" {
  description = "Grant allUsers invoker; the Web edge assertion gate then rejects direct origin requests (ctl.staging-edge-publication)."
  type        = bool
  default     = false
}

variable "web_core_assertion" {
  description = "Send Better Auth assertions to Core. Enable only after Core verifies them (core_web_assertion)."
  type        = bool
  default     = false
}

locals {
  # ctl.staging-web-runtime-bootstrap / ctl.staging-edge-publication: invoker is
  # IAM-only unless web_public, which relies on the Web edge assertion gate.
  web_enabled = var.web_runtime_image != null && var.web_identity_id != null && contains(keys(local.core_services), "api")
}

resource "google_cloud_run_v2_service" "web" {
  count                = local.web_enabled ? 1 : 0
  project              = "tastile-staging"
  location             = "asia-northeast1"
  name                 = "web"
  deletion_protection  = true
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = false
  template {
    service_account                  = "sa-web@tastile-staging.iam.gserviceaccount.com"
    timeout                          = "60s"
    max_instance_request_concurrency = 80
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
    containers {
      image   = var.web_runtime_image
      command = ["/app/infisical-bootstrap.sh"]
      args    = ["node", "server.js"]
      ports { container_port = 3000 }
      resources {
        cpu_idle          = true
        startup_cpu_boost = true
        limits            = { cpu = "1", memory = "512Mi" }
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      dynamic "env" {
        for_each = merge(local.core_selectors, {
          INFISICAL_MACHINE_IDENTITY_ID = var.web_identity_id
          INFISICAL_SECRET_PATH         = "/tastile/web/runtime"
          TASTILE_ENV                   = "staging"
          TASTILE_RUST_API_URL          = google_cloud_run_v2_service.core["api"].uri
          TASTILE_CORE_URL              = google_cloud_run_v2_service.core["api"].uri
          TASTILE_CORE_IAM_AUDIENCE     = google_cloud_run_v2_service.core["api"].uri
          # Also inlined at build; server code that reads them by dynamic key needs runtime values.
          NEXT_PUBLIC_APP_URL   = "https://staging-app.tastile.app"
          NEXT_PUBLIC_APEX_HOST = "staging.tastile.app"
          NEXT_PUBLIC_APP_HOST  = "staging-app.tastile.app"
          }, var.web_core_assertion ? {
          TASTILE_WEB_CORE_ASSERTION_ENABLED = "true"
        } : {})
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

resource "google_cloud_run_v2_service_iam_member" "web_public" {
  count    = local.web_enabled && var.web_public ? 1 : 0
  project  = "tastile-staging"
  location = "asia-northeast1"
  name     = google_cloud_run_v2_service.web[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "web_url" {
  value = try(google_cloud_run_v2_service.web[0].uri, null)
}
