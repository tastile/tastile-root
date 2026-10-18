# Staging-only direct FCM capability; no key files or static OAuth tokens.
resource "google_project_service" "fcm" {
  for_each = toset(["fcm.googleapis.com", "firebase.googleapis.com"])

  project            = "tastile-staging"
  service            = each.value
  disable_on_destroy = false
}

resource "google_project_iam_custom_role" "core_fcm_sender" {
  project     = "tastile-staging"
  role_id     = "coreFcmSender"
  title       = "Core FCM sender"
  description = "Send ID-only mobile hints through the worker service identity."
  permissions = ["cloudmessaging.messages.create"]
}

resource "google_project_iam_member" "core_fcm_sender" {
  project = "tastile-staging"
  role    = google_project_iam_custom_role.core_fcm_sender.name
  member  = "serviceAccount:sa-core-worker@tastile-staging.iam.gserviceaccount.com"
}
