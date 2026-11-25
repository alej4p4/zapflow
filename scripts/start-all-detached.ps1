# Idempotent ZapFlow detached production service launcher (outside Job Object)
$ErrorActionPreference = "Continue"

# 1. Check & start ZapFlow Server
$portActive = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if (-not $portActive) {
    $serverCmd = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*start-zapflow-prod.cmd*" }
    if (-not $serverCmd) {
        Write-Host "Starting ZapFlow server via WMI..."
        Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "cmd.exe /c E:\ZapFlow\scripts\start-zapflow-prod.cmd" } | Out-Null
    }
} else {
    Write-Host "Port 3000 is already active."
}

# 2. Check & start Cloudflare Tunnel
$cfProcess = Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue
if (-not $cfProcess) {
    $tunnelCmd = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*start-cloudflared-tunnel.cmd*" }
    if (-not $tunnelCmd) {
        Write-Host "Starting Cloudflare Tunnel via WMI..."
        Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "cmd.exe /c E:\ZapFlow\scripts\start-cloudflared-tunnel.cmd" } | Out-Null
    }
} else {
    Write-Host "Cloudflare tunnel is already active."
}
