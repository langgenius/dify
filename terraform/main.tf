# Google Cloud Infrastructure for Dify
# Creates all required GCP resources

terraform {
  required_version = ">= 1.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

# Variables
variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "GCP Zone"
  type        = string
  default     = "us-central1-a"
}

# Provider
provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

# Enable required APIs
resource "google_project_service" "services" {
  for_each = toset([
    "cloudbuild.googleapis.com",
    "run.googleapis.com",
    "sql-component.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com"
  ])
  
  service = each.value
}

# Artifact Registry
resource "google_artifact_registry_repository" "dify_repo" {
  location      = var.region
  repository_id = "dify-repo"
  description   = "Dify application Docker images"
  format        = "DOCKER"

  depends_on = [google_project_service.services]
}

# Cloud SQL PostgreSQL instance
resource "google_sql_database_instance" "dify_db" {
  name             = "dify-postgres"
  database_version = "POSTGRES_15"
  region           = var.region
  deletion_protection = false

  settings {
    tier              = "db-f1-micro"  # Free tier eligible
    disk_autoresize   = true
    disk_size         = 10
    disk_type         = "PD_SSD"
    
    ip_configuration {
      ipv4_enabled = true
      authorized_networks {
        value = "0.0.0.0/0"
        name  = "all"
      }
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
      }
    }
  }

  depends_on = [google_project_service.services]
}

# Database
resource "google_sql_database" "dify_database" {
  name     = "dify"
  instance = google_sql_database_instance.dify_db.name
}

# Database user
resource "google_sql_user" "dify_user" {
  name     = "dify"
  instance = google_sql_database_instance.dify_db.name
  password = random_password.db_password.result
}

# Random password for database
resource "random_password" "db_password" {
  length  = 32
  special = true
}

# Random secret key
resource "random_password" "secret_key" {
  length  = 64
  special = true
}

# Redis instance (Memory Store)
resource "google_redis_instance" "dify_redis" {
  name           = "dify-redis"
  tier           = "BASIC"
  memory_size_gb = 1
  region         = var.region
  redis_version  = "REDIS_7_0"

  depends_on = [google_project_service.services]
}

# Secret Manager secrets
resource "google_secret_manager_secret" "database_url" {
  secret_id = "database-url"
  
  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret_version" "database_url" {
  secret = google_secret_manager_secret.database_url.id
  secret_data = "postgresql://${google_sql_user.dify_user.name}:${google_sql_user.dify_user.password}@${google_sql_database_instance.dify_db.connection_name}/${google_sql_database.dify_database.name}"
}

resource "google_secret_manager_secret" "redis_url" {
  secret_id = "redis-url"
  
  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret_version" "redis_url" {
  secret = google_secret_manager_secret.redis_url.id
  secret_data = "redis://${google_redis_instance.dify_redis.host}:${google_redis_instance.dify_redis.port}/0"
}

resource "google_secret_manager_secret" "secret_key" {
  secret_id = "secret-key"
  
  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret_version" "secret_key" {
  secret = google_secret_manager_secret.secret_key.id
  secret_data = random_password.secret_key.result
}

# Placeholder for OpenAI API key (you'll add this manually)
resource "google_secret_manager_secret" "openai_api_key" {
  secret_id = "openai-api-key"
  
  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}

# Cloud Build trigger
resource "google_cloudbuild_trigger" "dify_trigger" {
  name        = "dify-deploy"
  description = "Deploy Dify on main branch push"

  github {
    owner = "wesamahakem"  # Change to your GitHub username
    name  = "dify"         # Change to your repo name
    push {
      branch = "main"
    }
  }

  filename = "cloudbuild.yaml"

  depends_on = [google_project_service.services]
}

# Outputs
output "project_id" {
  value = var.project_id
}

output "database_connection_name" {
  value = google_sql_database_instance.dify_db.connection_name
}

output "redis_host" {
  value = google_redis_instance.dify_redis.host
}

output "redis_port" {
  value = google_redis_instance.dify_redis.port
}

output "artifact_registry_url" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/dify-repo"
}
