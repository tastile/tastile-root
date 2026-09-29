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
