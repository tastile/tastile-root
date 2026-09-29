variable "projects" {
  description = "Existing, billing-linked GCP project IDs. Created only by operator-bootstrap.sh."
  type = object({
    dev        = string
    staging    = string
    production = string
  })

  validation {
    condition = alltrue([
      for id in values(var.projects) :
      can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", id))
    ])
    error_message = "Every project ID must satisfy the GCP project-id format."
  }
}

variable "region" {
  description = "Primary GCP region."
  type        = string
  default     = "asia-northeast1"
}

variable "core_repository_resource" {
  description = "Optional Cloud Build 2nd-gen repository resource for tastile/tastile-core. Operator creates the GitHub App connection; OpenTofu manages the trigger."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = var.core_repository_resource == null || can(regex(
      "^projects/[^/]+/locations/[^/]+/connections/[^/]+/repositories/[^/]+$",
      var.core_repository_resource
    ))
    error_message = "core_repository_resource must be a fully-qualified Cloud Build v2 repository resource name."
  }
}
