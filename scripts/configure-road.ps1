$ErrorActionPreference = 'Stop'
$imtRepo = Split-Path -Parent $PSScriptRoot
$imtEnvFile = Join-Path $imtRepo '.env'
Write-Host 'IMT road routing setup: 1 = Amap (China), 2 = HERE (US / Europe), 3 = both'
Write-Host 'Amap requires Web Service Key + enabled Advanced Logistics Truck API + coordinate conversion permission.'
$imtChoice = Read-Host 'Select 1 / 2 / 3'
if ($imtChoice -notin @('1', '2', '3')) { throw 'Invalid selection; no changes written.' }
$imtKeys = @()
if ($imtChoice -in @('1', '3')) { $imtKeys += 'AMAP_TRUCK_KEY' }
if ($imtChoice -in @('2', '3')) { $imtKeys += 'HERE_ROUTING_KEY' }
$imtUpdates = @{}
foreach ($imtKeyName in $imtKeys) {
    $imtSecure = Read-Host $imtKeyName -AsSecureString
    $imtPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($imtSecure)
    try {
        $imtValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($imtPointer)
        if ($imtValue -notmatch '^[A-Za-z0-9_-]{8,256}$') { throw 'Unexpected API key format; no changes written.' }
        $imtUpdates[$imtKeyName] = $imtValue
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($imtPointer)
        $imtSecure.Dispose()
    }
}
$imtLines = if (Test-Path -LiteralPath $imtEnvFile) { @(Get-Content -LiteralPath $imtEnvFile -Encoding UTF8) } else { @() }
foreach ($imtKeyName in $imtKeys) {
    $imtLines = @($imtLines | Where-Object { $_ -notmatch ('^\s*(export\s+)?' + [regex]::Escape($imtKeyName) + '\s*=') })
    $imtLines += $imtKeyName + '=' + $imtUpdates[$imtKeyName]
}
[IO.File]::WriteAllLines($imtEnvFile, [string[]]$imtLines, [Text.UTF8Encoding]::new($false))
$imtUpdates.Clear()
$imtValue = $null
Write-Host 'Saved to the local ignored .env file. Restart IMT, then make a road query to verify service permissions.'
