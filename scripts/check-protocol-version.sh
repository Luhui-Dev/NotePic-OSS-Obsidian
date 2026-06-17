#!/usr/bin/env bash
# Blocks a release if this repo's PROTOCOL_VERSION doesn't match the
# PROTOCOL_VERSION shipped in NotePic-OSS-CLI's latest GitHub Release.
# See PROTOCOL.md §1 and §6 for what this is enforcing and why.
set -euo pipefail

OTHER_REPO="Luhui-Dev/NotePic-OSS-CLI"
OTHER_FILE="notepic_oss/__init__.py"
AUTH_HEADER=()
if [ -n "${GITHUB_TOKEN:-}" ]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

LOCAL_VERSION=$(grep -m1 'PROTOCOL_VERSION' src/protocol.ts | sed -E 's/.*PROTOCOL_VERSION *= *"([^"]+)".*/\1/')
if [ -z "$LOCAL_VERSION" ]; then
  echo "::error::Could not parse local PROTOCOL_VERSION from src/protocol.ts."
  exit 1
fi

API_RESP=$(curl -fsSL ${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"} \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${OTHER_REPO}/releases/latest" 2>/dev/null || true)
OTHER_TAG=$(echo "$API_RESP" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/' || true)

if [ -z "$OTHER_TAG" ]; then
  echo "::warning::${OTHER_REPO} has no published release yet — skipping PROTOCOL_VERSION check."
  exit 0
fi

OTHER_CONTENT=$(curl -fsSL \
  "https://raw.githubusercontent.com/${OTHER_REPO}/${OTHER_TAG}/${OTHER_FILE}" 2>/dev/null || true)

if [ -z "$OTHER_CONTENT" ]; then
  echo "::warning::${OTHER_REPO}'s latest release (${OTHER_TAG}) doesn't have ${OTHER_FILE} (predates protocol versioning) — skipping check."
  exit 0
fi

OTHER_VERSION=$(echo "$OTHER_CONTENT" | grep -m1 'PROTOCOL_VERSION' | sed -E 's/.*PROTOCOL_VERSION *= *"([^"]+)".*/\1/' || true)
if [ -z "$OTHER_VERSION" ]; then
  echo "::warning::${OTHER_REPO}'s latest release (${OTHER_TAG}) has ${OTHER_FILE} but no PROTOCOL_VERSION in it (predates protocol versioning) — skipping check."
  exit 0
fi

echo "Local PROTOCOL_VERSION:        $LOCAL_VERSION"
echo "${OTHER_REPO} (${OTHER_TAG}):  $OTHER_VERSION"

if [ "$LOCAL_VERSION" != "$OTHER_VERSION" ]; then
  echo "::error::PROTOCOL_VERSION mismatch — this release is protocol ${LOCAL_VERSION}, but ${OTHER_REPO}'s latest release (${OTHER_TAG}) is still on protocol ${OTHER_VERSION}. See PROTOCOL.md §1. If this is an intentional, coordinated protocol bump, re-run this workflow via workflow_dispatch with skip_protocol_check=true to ship the first half, then release the other repo normally."
  exit 1
fi

echo "PROTOCOL_VERSION matches ${OTHER_REPO}'s latest release."
