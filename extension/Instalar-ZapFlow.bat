@echo off
chcp 65001 >nul
title Instalador ZapFlow AI

echo ========================================
echo   INSTALADOR ZAPFLOW AI
echo ========================================
echo.

set "DEST=%LOCALAPPDATA%\ZapFlow"

if not exist "%DEST%" mkdir "%DEST%"

echo Copiando arquivos para "%DEST%"...
xcopy /E /I /Y "%~dp0*" "%DEST%\" >nul

if %errorlevel% neq 0 (
    echo ERRO ao copiar arquivos.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   ARQUIVOS COPIADOS COM SUCESSO!
echo ========================================
echo.
echo Local: %DEST%
echo.
echo IMPORTANTE: Extensoes do Chrome NAO podem ser instaladas apenas por
echo registro do Windows. Você precisa carregar manualmente:
echo.
echo   1. Abra o Chrome em: chrome://extensions
echo   2. Ative o "Modo do desenvolvedor" (canto superior direito)
echo   3. Clique em "Carregar sem compactacao"
echo   4. Selecione a pasta: %DEST%
echo.
echo Apos carregar, abra web.whatsapp.com e clique no botao flutuante "ZF".
echo Login padrao: admin / admin123
echo.
echo Reinicie o Chrome apos a instalacao.
echo.
pause
