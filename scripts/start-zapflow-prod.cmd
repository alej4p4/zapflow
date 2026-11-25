@echo off
cd /d E:\ZapFlow
set NODE_ENV=production

if not exist "E:\ZapFlow\data\logs" mkdir "E:\ZapFlow\data\logs"

:loop
echo [%date% %time%] Starting ZapFlow Server... >> "E:\ZapFlow\data\logs\server.log"
call npx.cmd tsx src/server/index.ts >> "E:\ZapFlow\data\logs\server.log" 2>&1
echo [%date% %time%] ZapFlow Server exited with code %errorlevel%. Restarting in 3s... >> "E:\ZapFlow\data\logs\server.log"
ping 127.0.0.1 -n 4 >nul
goto loop
