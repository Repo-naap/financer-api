@echo off
chcp 65001 >nul
title FINANCER – Executar Testes Automatizados
cd /d "%~dp0"

set "PATH=%~dp0.tools\nodejs;%PATH%"
call "%~dp0.tools\nodejs\npm.cmd" --prefix backend run test
pause
