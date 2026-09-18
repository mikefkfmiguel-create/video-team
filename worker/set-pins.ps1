# Muda os codigos de acesso (sem mexer no login do 7Eventos).
#   equipa -> so ve os Tecnicos de Video
#   admin  -> ve todos os grupos
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$team = Read-Host 'Codigo da EQUIPA (so video) - Enter para manter'
if ($team) { $team | npx wrangler secret put VT_PIN }
$admin = Read-Host 'Codigo de ADMIN (tudo) - Enter para manter'
if ($admin) { $admin | npx wrangler secret put VT_PIN_ADMIN }
Write-Host 'Feito.'
