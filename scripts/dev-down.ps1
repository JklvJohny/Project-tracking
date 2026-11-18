# Stops the local dev stack ("dev: stop" task, bound to Ctrl+Alt+Shift+B in the user's VS Code keybindings).
# Terminating the VS Code tasks can leave the child processes (air's tracking-service.exe, next dev's node) running,
# so stop whatever still listens on the dev ports.
$ports = 8081, 3000
foreach ($port in $ports) {
  $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $owners) {
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p) {
      Write-Host "Stopping $($p.ProcessName) (pid $procId) on port $port"
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
}
Get-Process -Name air, tracking-service -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host "Stopping $($_.ProcessName) (pid $($_.Id))"
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Write-Host 'Dev stack stopped.'
