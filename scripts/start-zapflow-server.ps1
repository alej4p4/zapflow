$ErrorActionPreference = "Continue"
Set-Location "E:\ZapFlow"
New-Item -ItemType Directory -Force -Path "E:\ZapFlow\data\logs" | Out-Null
$env:NODE_ENV = "production"

while ($true) {
    $portActive = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    if ($portActive) {
        Start-Sleep -Seconds 10
        continue
    }

    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path "E:\ZapFlow\data\logs\server.log" -Value "[$ts] Starting ZapFlow production server..."
    & npx tsx src/server/index.ts *>> "E:\ZapFlow\data\logs\server.log"
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path "E:\ZapFlow\data\logs\server.log" -Value "[$ts] Server exited with code $LASTEXITCODE. Restarting in 3s..."
    Start-Sleep -Seconds 3
}
