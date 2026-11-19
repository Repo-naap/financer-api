@echo off
chcp 65001 >nul
title FINANCER – Gestão Financeira (Servidor Local)
cd /d "%~dp0"

set "NODE_EXE=%~dp0.tools\nodejs\node.exe"
if not exist "%NODE_EXE%" (
  echo [ERRO] Node.js portatil nao encontrado em .tools\nodejs\node.exe
  pause
  exit /b 1
)

echo ==============================================================
echo   FINANCER - Gestao Financeira (Frontend + Backend Integrados)
echo ==============================================================
echo.
echo   Iniciando servidor local sem necessidade de acesso Admin...
echo   Apos iniciar, acesse no navegador: http://localhost:3001
echo   (Pressione CTRL + C para encerrar o servidor)
echo.

set "PORT=3001"
set "SERVE_FRONTEND=true"
"%NODE_EXE%" "backend\dist\index.js"
pause
