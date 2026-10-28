# COBRA on Demand on Google Cloud (one project per environment: dev, staging, prod).
# Sign Google Cloud's HIPAA BAA before putting real data here, and use only
# services it covers. Not applied yet: review, then `terraform init/plan` per env.

terraform {
  required_version = ">= 1.6"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
  }
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  services = [
    "run.googleapis.com", "sqladmin.googleapis.com", "secretmanager.googleapis.com",
    "cloudkms.googleapis.com", "cloudscheduler.googleapis.com", "artifactregistry.googleapis.com",
    "compute.googleapis.com", "certificatemanager.googleapis.com", "iamcredentials.googleapis.com",
  ]
  image_base = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}"
}

resource "google_project_service" "apis" {
  for_each           = toset(local.services)
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "app" {
  repository_id = "cobra-on-demand"
  format        = "DOCKER"
  location      = var.region
  depends_on    = [google_project_service.apis]
}

# --- Identity -----------------------------------------------------------------

resource "google_service_account" "web" {
  account_id   = "cod-web"
  display_name = "COBRA on Demand web + jobs runtime"
}

resource "google_service_account" "scheduler" {
  account_id   = "cod-scheduler"
  display_name = "Cloud Scheduler invoker"
}

# --- Database (Cloud SQL Postgres, private IP, PITR) ---------------------------

resource "google_sql_database_instance" "main" {
  name                = "cod-${var.env}"
  database_version    = "POSTGRES_16"
  deletion_protection = var.env == "prod"
  settings {
    tier              = var.db_tier
    availability_type = var.env == "prod" ? "REGIONAL" : "ZONAL"
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
    }
    ip_configuration {
      ipv4_enabled    = false
      private_network = var.vpc_network
    }
    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }
  }
  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "app" {
  name     = "cobra"
  instance = google_sql_database_instance.main.name
}

# --- Secrets and keys -------------------------------------------------------------

resource "google_kms_key_ring" "app" {
  name     = "cod-${var.env}"
  location = var.region
}

# Wraps FIELD_ENCRYPTION_KEY (SSN, DOB, EIN). Rotated yearly.
resource "google_kms_crypto_key" "fields" {
  name            = "field-encryption"
  key_ring        = google_kms_key_ring.app.id
  rotation_period = "31536000s"
  lifecycle { prevent_destroy = true }
}

resource "google_secret_manager_secret" "secrets" {
  for_each  = toset(["DATABASE_URL", "FIELD_ENCRYPTION_KEY", "SESSION_SECRET", "CRON_SECRET"])
  secret_id = "cod-${lower(replace(each.value, "_", "-"))}"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "web_access" {
  for_each  = google_secret_manager_secret.secrets
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.web.email}"
}

# --- Documents: notice PDFs and uploads, 7-year retention lock ---------------------

resource "google_storage_bucket" "documents" {
  name                        = "${var.project_id}-cod-documents"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  versioning { enabled = true }
  retention_policy {
    retention_period = 220898664 # 7 years in seconds
    is_locked        = false     # lock in prod once counsel confirms the period
  }
}

resource "google_storage_bucket_iam_member" "web_documents" {
  bucket = google_storage_bucket.documents.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.web.email}"
}

# --- Cloud Run: web service and migrate job -----------------------------------------

resource "google_cloud_run_v2_service" "web" {
  name     = "cod-web"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  template {
    service_account = google_service_account.web.email
    scaling {
      min_instance_count = var.env == "prod" ? 1 : 0
      max_instance_count = 10
    }
    containers {
      image = "${local.image_base}/web:${var.image_tag}"
      ports { container_port = 8080 }
      env {
        name  = "APP_ROOT_DOMAIN"
        value = var.root_domain
      }
      env {
        name  = "ENROLLEE_SUBDOMAINS"
        value = "true"
      }
      env {
        name  = "DOCUMENT_STORAGE"
        value = "gcs"
      }
      env {
        name  = "DOCUMENT_BUCKET"
        value = google_storage_bucket.documents.name
      }
      dynamic "env" {
        for_each = google_secret_manager_secret.secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret_id
              version = "latest"
            }
          }
        }
      }
    }
    vpc_access {
      network_interfaces { network = var.vpc_network }
      egress = "PRIVATE_RANGES_ONLY"
    }
  }
  lifecycle { ignore_changes = [template[0].containers[0].image] } # deploys set the image
}

resource "google_cloud_run_v2_job" "migrate" {
  name     = "cod-migrate"
  location = var.region
  template {
    template {
      service_account = google_service_account.web.email
      containers {
        image   = "${local.image_base}/tools:${var.image_tag}"
        command = ["npm", "run", "db:migrate"]
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.secrets["DATABASE_URL"].secret_id
              version = "latest"
            }
          }
        }
      }
      vpc_access {
        network_interfaces { network = var.vpc_network }
      }
    }
  }
  lifecycle { ignore_changes = [template[0].template[0].containers[0].image] }
}

# --- Scheduler: every legal deadline is enforced by a job ---------------------------

resource "google_cloud_scheduler_job" "jobs" {
  for_each = {
    "send-election-notices" = "7 * * * *"
    "all"                   = "17 2 * * *"
  }
  name      = "cod-${each.key}"
  schedule  = each.value
  time_zone = "America/Los_Angeles"
  retry_config { retry_count = 3 }
  http_target {
    http_method = "POST"
    uri         = "https://${var.root_domain}/api/jobs/${each.key}"
    # The Authorization: Bearer CRON_SECRET header is added out of band
    # (gcloud scheduler jobs update http --update-headers) so the secret
    # never sits in Terraform state.
  }
}

# --- HTTPS load balancer with a wildcard cert for {company}.cobraondemand.com --------
# Certificate Manager DNS authorization + wildcard certificate, a serverless NEG
# for cod-web, a URL map, and a Cloud Armor policy go here. Left as a follow-up
# because it depends on where DNS for cobraondemand.com is hosted.
