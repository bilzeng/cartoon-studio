$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$cpu = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$platform = switch ($cpu) { 'ARM64' { 'win32-arm64' } 'AMD64' { 'win32-x64' } default { throw 'A 64-bit ARM or x86 system is required.' } }
$entry = (Get-Content 'scripts/portable/runtimes.tsv' | Where-Object { ($_ -split '\s+')[0] -eq $platform }) -split '\s+'
$temp = Join-Path (Get-Location) ('runtime/setup-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force $temp | Out-Null
try {
  $zip = Join-Path $temp 'node.zip'
  Invoke-WebRequest -UseBasicParsing -Uri $entry[1] -OutFile $zip
  if ((Get-FileHash -Algorithm SHA256 $zip).Hash -ne $entry[2]) { throw 'Node.js checksum mismatch.' }
  Expand-Archive -LiteralPath $zip -DestinationPath $temp
  Move-Item -LiteralPath (Get-ChildItem $temp -Directory -Filter 'node-v*').FullName -Destination 'runtime/sdk'
} finally { Remove-Item -LiteralPath $temp -Force -Recurse }
