terraform {
  required_version = ">= 1.9.0, < 2.0.0"

  required_providers {
    google = {
      source  = "opentofu/google"
      version = "~> 8.4.0"
    }
  }

  backend "gcs" {}
}

provider "google" {
  region = var.region
}
