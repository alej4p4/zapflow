$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force -Path "E:\ZapFlow\data\logs" | Out-Null

while ($true) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path "E:\ZapFlow\data\logs\tunnel-quick.log" -Value "[$ts] Starting Cloudflare Quick Tunnel..."
    & "C:\Users\SERVIDOR\cloudflared.exe" tunnel --url http://127.0.0.1:3000 *>> "E:\ZapFlow\data\logs\tunnel-quick.log"
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path "E:\ZapFlow\data\logs\tunnel-quick.log" -Value "[$ts] Quick tunnel exited. Restarting in 3s..."
    Start-Sleep -Seconds 3
}
