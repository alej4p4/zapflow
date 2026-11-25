$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force -Path "E:\ZapFlow\data\logs" | Out-Null

while ($true) {
    $existing = Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue
    if ($existing) {
        Start-Sleep -Seconds 10
        continue
    }

    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path "E:\ZapFlow\data\logs\tunnel-named.log" -Value "[$ts] Starting Cloudflare Named Tunnel..."
    & "C:\Users\SERVIDOR\cloudflared.exe" tunnel run --token eyJhIjoiNDYzZWZlM2Y0NDZhM2ExYThiYzEzY2VkMmIzODE1MjIiLCJ0IjoiOWZjNjVjNDYtMTZmZS00ZGQwLThlYTAtZjUzZmM3ZjJjZjk3IiwicyI6Ik9HWTRNbUpqWVRJdE1qTTBNaTAwWWpVekxXRTFNelV0T0dReU5qQTJOR0V5WldJNSJ9 *>> "E:\ZapFlow\data\logs\tunnel-named.log"
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path "E:\ZapFlow\data\logs\tunnel-named.log" -Value "[$ts] Named tunnel exited. Restarting in 3s..."
    Start-Sleep -Seconds 3
}
