$ErrorActionPreference = 'Stop'
$imtProject = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $imtProject
$imtNodeVersion = & node -p 'process.versions.node'
if (-not $imtNodeVersion.StartsWith('24.')) { throw 'Please install Node.js 24.14 or a newer 24.x release.' }
$env:npm_config_cache = Join-Path (Split-Path -Parent $imtProject) 'work\npm-cache'
if (-not (Test-Path -LiteralPath (Join-Path $imtProject 'node_modules'))) {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
Write-Host 'IMT: http://127.0.0.1:3100 - Keep this window open. Ctrl+C stops the application.'
& npm.cmd start
