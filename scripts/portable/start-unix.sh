#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
export PATH="$PWD/runtime/bin:$PATH"
if [ -x runtime/bin/node ]; then
  exec runtime/bin/node server/start.mjs --open
fi
case "$(uname -s)" in Darwin) os=darwin;; Linux) os=linux;; *) echo "Unsupported system"; exit 1;; esac
case "$(uname -m)" in arm64|aarch64) arch=arm64;; x86_64|amd64) arch=x64;; *) echo "A 64-bit ARM or x86 system is required"; exit 1;; esac
if [ ! -x runtime/sdk/bin/node ]; then
  url=$(awk -v p="$os-$arch" '$1==p {print $2}' scripts/portable/runtimes.tsv)
  expected=$(awk -v p="$os-$arch" '$1==p {print $3}' scripts/portable/runtimes.tsv)
  mkdir -p runtime
  tmp=$(mktemp -d "$PWD/runtime/setup.XXXXXX")
  trap 'rm -rf "$tmp"' EXIT
  echo "Preparing the local Node.js runtime..."
  if command -v curl >/dev/null; then curl -fL --retry 3 "$url" -o "$tmp/node.tgz"; else wget -O "$tmp/node.tgz" "$url"; fi
  if command -v sha256sum >/dev/null; then actual=$(sha256sum "$tmp/node.tgz"|awk '{print $1}'); else actual=$(shasum -a 256 "$tmp/node.tgz"|awk '{print $1}'); fi
  [ "$actual" = "$expected" ] || { echo "Node.js checksum mismatch"; exit 1; }
  tar -xzf "$tmp/node.tgz" -C "$tmp"
  mv "$tmp"/node-v*/ runtime/sdk
  rm -rf "$tmp"
  trap - EXIT
fi
export PATH="$PWD/runtime/sdk/bin:$PATH"
runtime/sdk/bin/node scripts/portable/bootstrap.mjs
exec runtime/sdk/bin/node server/start.mjs --open
