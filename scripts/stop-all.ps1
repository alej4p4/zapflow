Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -eq "powershell.exe" -and ($_.CommandLine -like "*ZapFlow\scripts\start-*" -or $_.CommandLine -like "*start-zapflow*" -or $_.CommandLine -like "*start-cloudflared*")) -or
    ($_.Name -eq "cmd.exe" -and ($_.CommandLine -like "*start-zapflow*" -or $_.CommandLine -like "*start-cloudflared*")) -or
    ($_.Name -eq "cloudflared.exe") -or
    ($_.Name -eq "node.exe" -and ($_.CommandLine -like "*src/server/index.ts*" -or $_.CommandLine -like "*ZapFlow*"))
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Write-Output "ZapFlow background services stopped."
