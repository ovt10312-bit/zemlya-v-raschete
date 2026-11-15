@echo off
setlocal
chcp 65001 >nul
title Земля - запуск Навигатора
set "APP_DIR=%USERPROFILE%\Desktop\navigator"
if exist "%~dp0package.json" set "APP_DIR=%~dp0"
if exist "%~dp0navigator\package.json" set "APP_DIR=%~dp0navigator"
if not exist "%APP_DIR%\server\local.mjs" (
 echo Не найдена папка программы: %APP_DIR%
 echo Помести этот файл внутрь папки navigator и запусти ещё раз.
 pause
 exit /b 1
)
if not exist "%APP_DIR%\dist\client\index.html" (
 echo Приложение ещё не собрано. В папке navigator выполни npm run build.
 pause
 exit /b 1
)
set "NODE_EXE=node"
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
"%NODE_EXE%" --version >nul 2>nul
if errorlevel 1 (
 echo Не найден Node.js. Установи Node.js 24 LTS и повтори запуск.
 pause
 exit /b 1
)
echo Открываем Земля - Навигатор...
powershell.exe -NoLogo -NoProfile -Command "try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:8787' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -eq 200 -and $r.Content -match 'Навигатор'){exit 0} } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 goto open_browser
start "Земля - сервер (не закрывать во время работы)" /min /D "%APP_DIR%" cmd.exe /d /k ""%NODE_EXE%" server\local.mjs"
powershell.exe -NoLogo -NoProfile -Command "$ok=$false; for($i=0;$i -lt 20;$i++){try{$r=Invoke-WebRequest -Uri 'http://127.0.0.1:8787' -UseBasicParsing -TimeoutSec 1; if($r.StatusCode -eq 200 -and $r.Content -match 'Навигатор'){$ok=$true;break}}catch{};Start-Sleep -Milliseconds 500};if($ok){exit 0}else{exit 1}" >nul 2>nul
if errorlevel 1 (
 echo Программа пока не ответила. Открой свёрнутое окно сервера и пришли скриншот ошибки.
 pause
 exit /b 1
)
:open_browser
start "" "http://127.0.0.1:8787"
exit /b 0
