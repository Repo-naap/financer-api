# =============================================================================
# FINANCER – Gestão Financeira | Script de Instalação / Execução no Windows
# =============================================================================
$ErrorActionPreference = "Stop"

Write-Host "===========================================================" -ForegroundColor Magenta
Write-Host "  FINANCER – Gestão Financeira | Preparação Windows" -ForegroundColor Magenta
Write-Host "===========================================================" -ForegroundColor Magenta

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js 20+ não encontrado. Instale Node.js LTS em https://nodejs.org/ e execute novamente."
}

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Arquivo .env criado a partir de .env.example. Configure DATABASE_URL e SESSION_SECRET antes de ir para produção." -ForegroundColor Yellow
}

Write-Host "[1/3] Instalando dependências do backend e frontend..." -ForegroundColor Cyan
npm --prefix backend install
npm --prefix frontend install

Write-Host "[2/3] Compilando backend e frontend..." -ForegroundColor Cyan
npm --prefix backend run build
npm --prefix frontend run build

Write-Host "[3/3] Tudo pronto! Para iniciar o FINANCER execute:" -ForegroundColor Green
Write-Host "      npm start" -ForegroundColor White
Write-Host "      E acesse http://localhost:3001 no navegador." -ForegroundColor White
