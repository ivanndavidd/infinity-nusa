# Uploads nusa. from this PC to the Oracle VM and installs it there (deploy/oracle/setup.sh).
#   First time (also copies .env and the database):
#     powershell -ExecutionPolicy Bypass -File deploy\oracle\push.ps1 -Server ubuntu@<VM IP> -Key <private key> -Migrate
#   Code updates later:
#     powershell -ExecutionPolicy Bypass -File deploy\oracle\push.ps1 -Server ubuntu@<VM IP> -Key <private key>
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [Parameter(Mandatory = $true)][string]$Key,
  [switch]$Migrate
)
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Key = (Resolve-Path $Key).Path
$staging = Join-Path $env:TEMP 'nusa-deploy'
$ssh = @('-i', $Key, '-o', 'StrictHostKeyChecking=accept-new')

function Invoke-Native([string]$what, [scriptblock]$run) {
  & $run
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)." }
}

# OpenSSH refuses a private key that other Windows accounts can read (keys saved to Downloads usually are).
icacls $Key /inheritance:r /grant:r "$($env:USERNAME):R" | Out-Null

if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Path $staging | Out-Null
try {
  Write-Host '==> Packing the app'
  # Windows' own tar: a GNU tar from Git would read "C:\..." as a remote host.
  Invoke-Native 'tar' { & "$env:SystemRoot\System32\tar.exe" -czf (Join-Path $staging 'app.tgz') -C $root src public deploy package.json package-lock.json }

  if ($Migrate) {
    Write-Host '==> Exporting the database'
    $line = Get-Content (Join-Path $root '.env') | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
    if (-not $line) { throw 'DATABASE_URL is missing from .env.' }
    $db = [Uri]($line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"', "'")
    $user, $password = $db.UserInfo.Split(':', 2) | ForEach-Object { [Uri]::UnescapeDataString($_) }
    $port = if ($db.Port -gt 0) { $db.Port } else { 5432 }
    # The VM runs PostgreSQL 16, whose pg_restore reads dumps from pg_dump 16 or older.
    $pgDump = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\pg_dump.exe' -ErrorAction SilentlyContinue |
      Where-Object { $_.Directory.Parent.Name -match '^\d+$' -and [int]$_.Directory.Parent.Name -le 16 } |
      Sort-Object { [int]$_.Directory.Parent.Name } | Select-Object -Last 1
    if (-not $pgDump) { throw 'No pg_dump (PostgreSQL 16 or older) found under C:\Program Files\PostgreSQL.' }
    # The password goes in through PGPASSWORD, so it never shows up in an error message about the command line.
    $dumpFile = Join-Path $staging 'spending.dump'
    $env:PGPASSWORD = $password
    try {
      Invoke-Native 'pg_dump' {
        & $pgDump.FullName --format=custom --no-owner --no-privileges "--file=$dumpFile" "--host=$($db.Host)" "--port=$port" "--username=$user" "--dbname=$($db.AbsolutePath.TrimStart('/'))"
      }
    }
    finally {
      Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
    Copy-Item (Join-Path $root '.env') (Join-Path $staging '.env')
  }

  Write-Host "==> Uploading to $Server"
  Invoke-Native 'ssh' { ssh @ssh $Server 'rm -rf ~/nusa-deploy && mkdir -p ~/nusa-deploy/app' }
  $files = @(Get-ChildItem -Force $staging | ForEach-Object { $_.FullName }) # an array even for one file, or @files splats its letters
  Invoke-Native 'scp' { scp @ssh @files "${Server}:nusa-deploy/" }

  Write-Host '==> Installing on the server'
  $remote = 'tar -xzf ~/nusa-deploy/app.tgz -C ~/nusa-deploy/app && sed -i ''s/\r$//'' ~/nusa-deploy/app/deploy/oracle/*.sh && sudo bash ~/nusa-deploy/app/deploy/oracle/setup.sh ~/nusa-deploy'
  Invoke-Native 'setup' { ssh -t @ssh $Server $remote }
}
finally {
  Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
}
