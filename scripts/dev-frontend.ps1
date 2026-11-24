# Starts the Next.js dev server for VS Code's "dev" task.
# VS Code passes the workspace path with a lowercase drive letter (d:\...). With that cwd, Vite/Next on Windows can
# load the same module twice, so switch to an upper-case drive path first.
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root 'frontend'
$dir = $dir.Substring(0, 1).ToUpper() + $dir.Substring(1)
Set-Location -LiteralPath $dir
npm run dev
