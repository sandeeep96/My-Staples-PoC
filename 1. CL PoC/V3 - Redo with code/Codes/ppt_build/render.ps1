# Render every slide of a deck to PNG with PowerPoint (visual QA).
# Usage: powershell -File render.ps1 <deck.pptx> <out_dir>
param([string]$Deck, [string]$OutDir)
New-Item -ItemType Directory -Force $OutDir | Out-Null
Get-ChildItem $OutDir -Filter *.PNG | Remove-Item -Force
$app = New-Object -ComObject PowerPoint.Application
$p = $app.Presentations.Open((Resolve-Path $Deck).Path, $true, $false, $false)
$p.Export((Resolve-Path $OutDir).Path, "PNG", 1920, 1080)
$p.Close()
$app.Quit()
Get-ChildItem $OutDir -Filter *.PNG | ForEach-Object { $_.FullName }
