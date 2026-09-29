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


variable "ci_dispatcher" {
  description = "Optional non-secret configuration for the private Core CI dispatcher. Null keeps the runtime job/schedule disabled until its image and external Infisical/GitHub bindings exist."
  type = object({
    image                   = string
    infisical_domain        = string
    infisical_identity_id   = string
    infisical_project_id    = string
    infisical_environment   = optional(string, "dev")
    infisical_secret_path   = optional(string, "/tastile/ci")
    github_app_id           = string
    github_installation_id  = string
  })
  default  = null
  nullable = true
}
