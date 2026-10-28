#!/usr/bin/env bash
# Put COBRA on Demand on your own domain, including {company}.yourdomain.com
# for every employer's enrollee portal. Run in Cloud Shell AFTER the first
# successful deploy (the cod-web Cloud Run service must exist):
#
#   PROJECT_ID=your-project-id DOMAIN=cobraondemand.com bash infra/gcp/domain.sh
#
# Creates a global external HTTPS load balancer in front of Cloud Run with a
# Google-managed certificate covering DOMAIN and *.DOMAIN (Certificate Manager,
# DNS authorization), plus an HTTP→HTTPS redirect. It prints the DNS records to
# add at your registrar. Safe to re-run; re-running also re-prints the records.

set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
: "${DOMAIN:?Set DOMAIN, e.g. cobraondemand.com}"
REGION="${REGION:-us-west2}"
SERVICE="${SERVICE:-cod-web}"

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
exists() { "$@" >/dev/null 2>&1; }

gcloud config set project "$PROJECT_ID" >/dev/null
gcloud services enable compute.googleapis.com certificatemanager.googleapis.com

exists gcloud run services describe "$SERVICE" --region "$REGION" ||
  { echo "Cloud Run service $SERVICE not found in $REGION. Run the Deploy workflow first."; exit 1; }

say "Static IP"
exists gcloud compute addresses describe cod-ip --global ||
  gcloud compute addresses create cod-ip --global --ip-version IPV4
IP="$(gcloud compute addresses describe cod-ip --global --format='value(address)')"

say "Wildcard certificate for $DOMAIN and *.$DOMAIN"
exists gcloud certificate-manager dns-authorizations describe cod-dns-auth ||
  gcloud certificate-manager dns-authorizations create cod-dns-auth --domain "$DOMAIN"
exists gcloud certificate-manager certificates describe cod-cert ||
  gcloud certificate-manager certificates create cod-cert \
    --domains "$DOMAIN,*.$DOMAIN" --dns-authorizations cod-dns-auth
exists gcloud certificate-manager maps describe cod-cert-map ||
  gcloud certificate-manager maps create cod-cert-map
exists gcloud certificate-manager maps entries describe cod-apex --map cod-cert-map ||
  gcloud certificate-manager maps entries create cod-apex --map cod-cert-map --hostname "$DOMAIN" --certificates cod-cert
exists gcloud certificate-manager maps entries describe cod-wildcard --map cod-cert-map ||
  gcloud certificate-manager maps entries create cod-wildcard --map cod-cert-map --hostname "*.$DOMAIN" --certificates cod-cert

say "Load balancer → Cloud Run"
exists gcloud compute network-endpoint-groups describe cod-neg --region "$REGION" ||
  gcloud compute network-endpoint-groups create cod-neg --region "$REGION" \
    --network-endpoint-type serverless --cloud-run-service "$SERVICE"
if ! exists gcloud compute backend-services describe cod-backend --global; then
  gcloud compute backend-services create cod-backend --global --load-balancing-scheme EXTERNAL_MANAGED
  gcloud compute backend-services add-backend cod-backend --global \
    --network-endpoint-group cod-neg --network-endpoint-group-region "$REGION"
fi
exists gcloud compute url-maps describe cod-urlmap --global ||
  gcloud compute url-maps create cod-urlmap --global --default-service cod-backend
exists gcloud compute target-https-proxies describe cod-https --global ||
  gcloud compute target-https-proxies create cod-https --global --url-map cod-urlmap --certificate-map cod-cert-map
exists gcloud compute forwarding-rules describe cod-https-rule --global ||
  gcloud compute forwarding-rules create cod-https-rule --global --load-balancing-scheme EXTERNAL_MANAGED \
    --address cod-ip --target-https-proxy cod-https --ports 443

say "HTTP → HTTPS redirect"
if ! exists gcloud compute url-maps describe cod-redirect --global; then
  cat > /tmp/cod-redirect.yaml <<EOF
name: cod-redirect
defaultUrlRedirect:
  httpsRedirect: true
  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT
EOF
  gcloud compute url-maps import cod-redirect --global --source /tmp/cod-redirect.yaml --quiet
fi
exists gcloud compute target-http-proxies describe cod-http --global ||
  gcloud compute target-http-proxies create cod-http --global --url-map cod-redirect
exists gcloud compute forwarding-rules describe cod-http-rule --global ||
  gcloud compute forwarding-rules create cod-http-rule --global --load-balancing-scheme EXTERNAL_MANAGED \
    --address cod-ip --target-http-proxy cod-http --ports 80

CNAME_NAME="$(gcloud certificate-manager dns-authorizations describe cod-dns-auth --format='value(dnsResourceRecord.name)')"
CNAME_DATA="$(gcloud certificate-manager dns-authorizations describe cod-dns-auth --format='value(dnsResourceRecord.data)')"

cat <<EOF

$(say "Add these DNS records at your DNS provider for $DOMAIN")
  Type   Name                                   Value
  A      $DOMAIN (@)                            $IP
  A      *.$DOMAIN                              $IP
  CNAME  ${CNAME_NAME%.}   ${CNAME_DATA}

Remove any other A/AAAA/CNAME records for @ and * first. The certificate
usually becomes ACTIVE 15–60 minutes after the records resolve. Check with:

  gcloud certificate-manager certificates describe cod-cert --format='value(managed.state)'

When it says ACTIVE, add the GitHub repository variable APP_DOMAIN = $DOMAIN and
re-run the Deploy workflow. Enrollee links then use {company}.$DOMAIN.
EOF
