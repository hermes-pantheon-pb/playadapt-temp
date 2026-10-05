#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
export PATH="$HOME/.dotnet:$HOME/.gemini/antigravity-ide/bin:$PATH"

echo "==> 1. Building Web Bundle..."
cd web
npm install
npm run build
cd "$SCRIPT_DIR"

echo "==> 2. Web bundle built successfully in src/Jellyfin.Plugin.PlayAdapt/Web/"

if command -v dotnet >/dev/null 2>&1; then
    echo "==> 3. Building .NET 8.0 Plugin (Release)..."
    dotnet build src/Jellyfin.Plugin.PlayAdapt/Jellyfin.Plugin.PlayAdapt.csproj -c Release

    echo "==> 4. Packaging Plugin zip..."
    rm -rf dist
    mkdir -p dist/package
    cp src/Jellyfin.Plugin.PlayAdapt/bin/Release/net8.0/Jellyfin.Plugin.PlayAdapt.dll dist/package/
    cp meta.json dist/package/
    cp docs/images/logo.png dist/package/logo.png
    (cd dist/package && python3 -m zipfile -c ../../jellyfin-plugin-playadapt.zip .)

    # Calculate MD5 checksum
    MD5_CHECKSUM=$(python3 -c "import hashlib; print(hashlib.md5(open('jellyfin-plugin-playadapt.zip', 'rb').read()).hexdigest())")
    echo "==> Plugin zip created: jellyfin-plugin-playadapt.zip (MD5: $MD5_CHECKSUM)"

    # Update manifest.json with actual checksum
    python3 -c "
import json
with open('manifest.json', 'r') as f:
    data = json.load(f)
if data and 'versions' in data[0] and data[0]['versions']:
    data[0]['versions'][0]['checksum'] = '$MD5_CHECKSUM'
with open('manifest.json', 'w') as f:
    json.dump(data, f, indent=2)
"
    echo "==> manifest.json updated with checksum."
    echo "==> Build complete and ready for deployment!"
else
    echo "==> Note: dotnet CLI is not installed locally. Web bundle is ready."
fi
