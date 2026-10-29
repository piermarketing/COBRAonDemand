#!/usr/bin/env bash
# Wire up a Cloud Run service that was created in the console with
# "Continuously deploy from a repository" (Cloud Build builds the Dockerfile
# on every push). Run in Cloud Shell from the repo folder:
#
#   PROJECT_ID=your-project-id SERVICE=your-service-name bash infra/gcp/configure-service.sh
#
# It runs bootstrap.sh (safe to repeat) for the database, secrets and storage,
# then points the service at them, turns on migrations at startup, creates
# the first ops login, and schedules the COBRA deadline jobs over HTTPS.
# Env vars and secrets set here carry over to every revision Cloud Build deploys.

set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
: "${SERVICE:?Set SERVICE to the Cloud Run service name}"
REGION="${REGION:-us-west2}"          # region of the Cloud Run service
DB_REGION="${DB_REGION:-us-west2}"    # region bootstrap.sh used for Cloud SQL
OPS_EMAIL="${OPS_EMAIL:-ops@cobraondemand.com}"
HERE="$(cd "$(dirname "$0")" && pwd)"

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
exists() { "$@" >/dev/null 2>&1; }

gcloud config set project "$PROJECT_ID" >/dev/null
exists gcloud run services describe "$SERVICE" --region "$REGION" ||
  { echo "No Cloud Run service \"$SERVICE\" in $REGION. Set SERVICE and REGION to match the console."; exit 1; }

say "Database, secrets and storage (bootstrap.sh)"
SKIP_GITHUB_SUMMARY=1 REGION="$DB_REGION" PROJECT_ID="$PROJECT_ID" bash "$HERE/bootstrap.sh"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_SA="cod-runtime@$PROJECT_ID.iam.gserviceaccount.com"
SQL="$(gcloud sql instances describe cod-staging --format='value(connectionName)')"
BUCKET="$PROJECT_ID-cod-documents"
URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"

say "Let Cloud Build deploy revisions that run as $RUNTIME_SA"
for sa in "$PROJECT_NUMBER-compute@developer.gserviceaccount.com" "$PROJECT_NUMBER@cloudbuild.gserviceaccount.com"; do
  if exists gcloud iam service-accounts describe "$sa" || [[ "$sa" == *cloudbuild* ]]; then
    gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --member "serviceAccount:$sa" \
      --role roles/iam.serviceAccountUser >/dev/null 2>&1 && echo "  $sa" || true
  fi
done

say "Configuring $SERVICE"
gcloud run services update "$SERVICE" --region "$REGION" \
  --service-account "$RUNTIME_SA" \
  --add-cloudsql-instances "$SQL" \
  --memory 1Gi \
  --update-secrets "DATABASE_URL=cod-database-url:latest,FIELD_ENCRYPTION_KEY=cod-field-encryption-key:latest,SESSION_SECRET=cod-session-secret:latest,CRON_SECRET=cod-cron-secret:latest,BOOTSTRAP_OPS_PASSWORD=cod-seed-ops-password:latest" \
  --update-env-vars "DB_SOCKET_DIR=/cloudsql/$SQL,DB_AUTO_MIGRATE=true,DOCUMENT_STORAGE=gcs,DOCUMENT_BUCKET=$BUCKET,APP_BASE_URL=$URL,BOOTSTRAP_OPS_EMAIL=$OPS_EMAIL,ALLOW_SANDBOX=true"
gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" \
  --member allUsers --role roles/run.invoker >/dev/null

say "Scheduling the deadline jobs"
CRON="$(gcloud secrets versions access latest --secret cod-cron-secret)"
for spec in "cod-hourly|7 * * * *|send-election-notices" "cod-daily|17 2 * * *|all"; do
  IFS='|' read -r name cron job <<<"$spec"
  exists gcloud scheduler jobs describe "$name" --location "$DB_REGION" &&
    gcloud scheduler jobs delete "$name" --location "$DB_REGION" --quiet >/dev/null
  gcloud scheduler jobs create http "$name" --location "$DB_REGION" --schedule "$cron" \
    --time-zone "America/Los_Angeles" --uri "$URL/api/jobs/$job" --http-method POST \
    --headers "Authorization=Bearer $CRON" --attempt-deadline 600s >/dev/null
  echo "  $name → $URL/api/jobs/$job ($cron)"
done

say "Checking the app"
for i in $(seq 1 20); do
  if curl -fsS "$URL/api/health"; then echo; break; fi
  sleep 6
done

cat <<EOF

$(say "Done")
  App:        $URL
  Ops login:  $URL/login
              $OPS_EMAIL
              password: gcloud secrets versions access latest --secret cod-seed-ops-password

Try it: sign up a demo employer at $URL/get-started (35+ employees, made-up
details), connect the Sandbox source, confirm the modules, go live, then use
"Sandbox: change source data" under Qualifying events. Email isn't connected
yet, so one-time codes and notices appear in the ops console under Outbox.
EOF
