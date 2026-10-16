terraform {
  required_version = ">= 1.9.0, < 2.0.0"
  backend "gcs" {}
  required_providers {
    google = {
      source  = "opentofu/google"
      version = "~> 8.4.0"
    }
  }
}

provider "google" {
  project = "tastile-staging"
  region  = "asia-northeast1"
}

variable "database_active" {
  description = "Operator-controlled staging window. Create with true; stop with false after callers and connections are stopped."
  type        = bool
  default     = false
}

# Secret values and database user passwords must never enter this state.
resource "google_sql_database_instance" "staging" {
  name                = "tastile-staging-pg"
  project             = "tastile-staging"
  region              = "asia-northeast1"
  database_version    = "POSTGRES_17"
  deletion_protection = true

  settings {
    tier                        = "db-f1-micro"
    edition                     = "ENTERPRISE"
    availability_type           = "ZONAL"
    activation_policy           = var.database_active ? "ALWAYS" : "NEVER"
    disk_size                   = 10
    disk_type                   = "PD_SSD"
    disk_autoresize             = true
    deletion_protection_enabled = true
    connector_enforcement       = "REQUIRED"
    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }
    backup_configuration {
      enabled                        = true
      start_time                     = "18:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }
  }
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_sql_database" "domain" {
  name            = "tastile_core"
  project         = "tastile-staging"
  instance        = google_sql_database_instance.staging.name
  deletion_policy = "ABANDON"
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_sql_database" "auth" {
  name            = "tastile_auth"
  project         = "tastile-staging"
  instance        = google_sql_database_instance.staging.name
  deletion_policy = "ABANDON"
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_project_iam_member" "sql_client" {
  for_each = toset(["sa-core-api", "sa-core-worker", "sa-core-migrate", "sa-web"])
  project  = "tastile-staging"
  role     = "roles/cloudsql.client"
  member   = "serviceAccount:${each.value}@tastile-staging.iam.gserviceaccount.com"
}

output "connection_name" {
  value = google_sql_database_instance.staging.connection_name
}
