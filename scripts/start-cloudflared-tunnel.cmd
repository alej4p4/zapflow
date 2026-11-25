@echo off
cd /d E:\ZapFlow

if not exist "E:\ZapFlow\data\logs" mkdir "E:\ZapFlow\data\logs"

:loop
echo [%date% %time%] Starting Cloudflare Tunnel... >> "E:\ZapFlow\data\logs\tunnel-named.log"
"C:\Users\SERVIDOR\cloudflared.exe" tunnel run --token eyJhIjoiNDYzZWZlM2Y0NDZhM2ExYThiYzEzY2VkMmIzODE1MjIiLCJ0IjoiOWZjNjVjNDYtMTZmZS00ZGQwLThlYTAtZjUzZmM3ZjJjZjk3IiwicyI6Ik9HWTRNbUpqWVRJdE1qTTBNaTAwWWpVekxXRTFNelV0T0dReU5qQTJOR0V5WldJNSJ9 >> "E:\ZapFlow\data\logs\tunnel-named.log" 2>&1
echo [%date% %time%] Cloudflare Tunnel exited with code %errorlevel%. Restarting in 3s... >> "E:\ZapFlow\data\logs\tunnel-named.log"
ping 127.0.0.1 -n 4 >nul
goto loop
