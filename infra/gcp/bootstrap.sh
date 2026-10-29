#!/usr/bin/env bash
# One-time setup of a COBRA on Demand environment in Google Cloud.
#
# Run it in Cloud Shell (https://shell.cloud.google.com), signed in as a
# project owner:
#
#   git clone https://github.com/piermarketing/COBRAonDemand.git && cd COBRAonDemand
#   PROJECT_ID=your-project-id bash infra/gcp/bootstrap.sh
#
# It is safe to re-run: existing resources are left alone.
#
# What it creates (staging by default, synthetic data only until BAAs are signed):
#   - APIs, Artifact Registry repo
#   - Cloud SQL Postgres 16 with backups + point-in-time recovery, database and app user
#   - Secret Manager secrets: DATABASE_URL, FIELD_ENCRYPTION_KEY, SESSION_SECRET, CRON_SECRET, seed passwords
#   - Cloud Storage bucket for notice PDFs (private, versioned)
#   - Service accounts: cod-runtime (the app), cod-deployer (GitHub Actions), cod-scheduler
#   - Workload Identity Federation so GitHub Actions deploys with no stored keys
#   - Cloud Scheduler triggers for the COBRA deadline jobs
# GitHub Actions then builds the containers and creates the Cloud Run service and jobs.

set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID=your-project-id}"
ENV_NAME="${ENV_NAME:-staging}"
REGION="${REGION:-us-west2}"
GITHUB_REPO="${GITHUB_REPO:-piermarketing/COBRAonDemand}"
SQL_TIER="${SQL_TIER:-db-g1-small}"
SQL_INSTANCE="cod-${ENV_NAME}"
BUCKET="${PROJECT_ID}-cod-documents"
AR_REPO="cobra-on-demand"

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
exists() { "$@" >/dev/null 2>&1; }
rand() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-40}"; }

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

say "Enabling APIs (a few minutes the first time)"
gcloud services enable \
  run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com cloudscheduler.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  storage.googleapis.com cloudbuild.googleapis.com

say "Artifact Registry"
exists gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" ||
  gcloud artifacts repositories create "$AR_REPO" --repository-format=docker --location "$REGION" \
    --description "COBRA on Demand images"

say "Service accounts"
for sa in cod-runtime cod-deployer cod-scheduler; do
  exists gcloud iam service-accounts describe "$sa@$PROJECT_ID.iam.gserviceaccount.com" ||
    gcloud iam service-accounts create "$sa" --display-name "COBRA on Demand: $sa"
done
RUNTIME_SA="cod-runtime@$PROJECT_ID.iam.gserviceaccount.com"
DEPLOYER_SA="cod-deployer@$PROJECT_ID.iam.gserviceaccount.com"
SCHEDULER_SA="cod-scheduler@$PROJECT_ID.iam.gserviceaccount.com"

bind() { gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$1" --role "$2" --condition=None >/dev/null; }
bind "$RUNTIME_SA" roles/cloudsql.client
bind "$RUNTIME_SA" roles/secretmanager.secretAccessor
bind "$RUNTIME_SA" roles/logging.logWriter
bind "$DEPLOYER_SA" roles/run.admin
bind "$DEPLOYER_SA" roles/artifactregistry.writer
bind "$SCHEDULER_SA" roles/run.invoker
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member "serviceAccount:$DEPLOYER_SA" --role roles/iam.serviceAccountUser >/dev/null

say "Cloud SQL (Postgres 16). Creating an instance takes about 10 minutes"
if ! exists gcloud sql instances describe "$SQL_INSTANCE"; then
  gcloud sql instances create "$SQL_INSTANCE" \
    --database-version=POSTGRES_16 --edition=ENTERPRISE --tier="$SQL_TIER" --region="$REGION" \
    --storage-auto-increase --backup-start-time=09:00 --enable-point-in-time-recovery \
    --retained-backups-count=14 --deletion-protection
fi
exists gcloud sql databases describe cobra --instance "$SQL_INSTANCE" ||
  gcloud sql databases create cobra --instance "$SQL_INSTANCE"
SQL_CONNECTION="$(gcloud sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')"

secret_exists() { exists gcloud secrets describe "$1"; }
put_secret() { # name value
  if secret_exists "$1"; then return; fi
  printf '%s' "$2" | gcloud secrets create "$1" --replication-policy=automatic --data-file=- >/dev/null
  echo "  created secret $1"
}

say "Database user and secrets"
if ! secret_exists cod-database-url; then
  DB_PASSWORD="$(rand 40)"
  if exists gcloud sql users describe cod_app --instance "$SQL_INSTANCE"; then
    gcloud sql users set-password cod_app --instance "$SQL_INSTANCE" --password "$DB_PASSWORD"
  else
    gcloud sql users create cod_app --instance "$SQL_INSTANCE" --password "$DB_PASSWORD"
  fi
  # Host is a placeholder: the app connects through the Cloud SQL socket (DB_SOCKET_DIR).
  put_secret cod-database-url "postgres://cod_app:${DB_PASSWORD}@localhost:5432/cobra"
fi
put_secret cod-field-encryption-key "$(head -c 32 /dev/urandom | base64)"
put_secret cod-session-secret "$(rand 64)"
put_secret cod-cron-secret "$(rand 48)"
put_secret cod-seed-ops-password "$(rand 24)"
put_secret cod-seed-employer-password "$(rand 24)"

say "Document storage"
exists gcloud storage buckets describe "gs://$BUCKET" ||
  gcloud storage buckets create "gs://$BUCKET" --location "$REGION" --uniform-bucket-level-access \
    --public-access-prevention
gcloud storage buckets update "gs://$BUCKET" --versioning >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member "serviceAccount:$RUNTIME_SA" --role roles/storage.objectAdmin >/dev/null

say "Workload Identity Federation for GitHub Actions ($GITHUB_REPO)"
exists gcloud iam workload-identity-pools describe github --location global ||
  gcloud iam workload-identity-pools create github --location global --display-name "GitHub Actions"
exists gcloud iam workload-identity-pools providers describe github --location global --workload-identity-pool github ||
  gcloud iam workload-identity-pools providers create-oidc github \
    --location global --workload-identity-pool github \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition "assertion.repository == '$GITHUB_REPO'"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$GITHUB_REPO" >/dev/null
WIF_PROVIDER="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github"

say "Cloud Scheduler → COBRA deadline jobs (the Cloud Run jobs are created by the first deploy)"
schedule() { # name cron cloud-run-job
  local uri="https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/$3:run"
  if exists gcloud scheduler jobs describe "$1" --location "$REGION"; then return; fi
  gcloud scheduler jobs create http "$1" --location "$REGION" --schedule "$2" \
    --time-zone "America/Los_Angeles" --uri "$uri" --http-method POST \
    --oauth-service-account-email "$SCHEDULER_SA" --attempt-deadline 600s >/dev/null
  echo "  scheduled $1 ($2)"
}
schedule cod-hourly "7 * * * *" cod-jobs-hourly
schedule cod-daily "17 2 * * *" cod-jobs-daily

[ -n "${SKIP_GITHUB_SUMMARY:-}" ] && exit 0

cat <<EOF

$(say "Done")
Add these as GitHub repository VARIABLES (Settings → Secrets and variables → Actions → Variables)
for $GITHUB_REPO, or paste this block back to Claude. None of them are secrets.

  GCP_PROJECT_ID     = $PROJECT_ID
  GCP_REGION         = $REGION
  GCP_WIF_PROVIDER   = $WIF_PROVIDER
  GCP_DEPLOY_SA      = $DEPLOYER_SA
  GCP_RUNTIME_SA     = $RUNTIME_SA
  GCP_SQL_CONNECTION = $SQL_CONNECTION
  GCP_DOCUMENT_BUCKET= $BUCKET

If the GitHub CLI is signed in here, this sets them for you:

  gh variable set GCP_PROJECT_ID -R $GITHUB_REPO -b "$PROJECT_ID"
  gh variable set GCP_REGION -R $GITHUB_REPO -b "$REGION"
  gh variable set GCP_WIF_PROVIDER -R $GITHUB_REPO -b "$WIF_PROVIDER"
  gh variable set GCP_DEPLOY_SA -R $GITHUB_REPO -b "$DEPLOYER_SA"
  gh variable set GCP_RUNTIME_SA -R $GITHUB_REPO -b "$RUNTIME_SA"
  gh variable set GCP_SQL_CONNECTION -R $GITHUB_REPO -b "$SQL_CONNECTION"
  gh variable set GCP_DOCUMENT_BUCKET -R $GITHUB_REPO -b "$BUCKET"

Then run the "Deploy" workflow in GitHub Actions (tick "seed demo data" the first time).
EOF
