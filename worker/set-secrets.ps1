# Envia o login do 7Eventos e o PIN da equipa para o Cloudflare como segredos.
# Le o user/password do config.json (ao lado do VideoTeam.exe). Nada fica no codigo.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$cfg = Get-Content ..\config.json -Raw | ConvertFrom-Json
$cfg.user     | npx wrangler secret put VT_USER
$cfg.password | npx wrangler secret put VT_PASSWORD
$pin = Read-Host 'PIN para a equipa (o que vais partilhar)'
$pin          | npx wrangler secret put VT_PIN
Write-Host 'Segredos enviados.'
