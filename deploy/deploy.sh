#!/usr/bin/env bash
set -euo pipefail
cd /opt/imt
sha="${1:-}"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid SHA'; exit 1; }
exec 9>/opt/imt/.deploy.lock
flock -n 9 || { echo 'Another deployment is running'; exit 1; }
previous="$(cat current-image 2>/dev/null || true)"
image="ghcr.io/object-tao/imt:sha-$sha"
# .env contains application secrets and stays on this server. Never replace it from CI.
IMT_IMAGE="$image" docker compose pull app
IMT_IMAGE="$image" docker compose up -d --no-deps app
for attempt in $(seq 1 30); do
  container="$(docker compose ps -q app)"
  if [ -n "$container" ] && [ "$(docker inspect --format '{{.State.Health.Status}}' "$container")" = healthy ]; then
    printf '%s\n' "$image" > current-image
    echo "Deployed $image"
    exit 0
  fi
  sleep 2
done
echo 'Health check failed, restoring previous image'
if [ -n "$previous" ]; then IMT_IMAGE="$previous" docker compose up -d --no-deps app; fi
exit 1
