@echo off
setlocal
chcp 65001 >nul
title Земля - обновление Навигатора
set "ZN_APP=%USERPROFILE%\Desktop\navigator"
if exist "%~dp0package.json" set "ZN_APP=%~dp0"
if not exist "%ZN_APP%\package.json" (
 echo Папка программы не найдена. Перемести этот файл в папку navigator.
 pause
 exit /b 1
)
echo Перед обновлением закрой чёрное окно работающего Навигатора.
echo Данные кабинета будут сохранены; также создадим резервную копию папки .data.
pause
powershell.exe -NoLogo -NoProfile -Command "$c=New-Object Net.Sockets.TcpClient;try{$t=$c.ConnectAsync('127.0.0.1',8787);if($t.Wait(1000) -and $c.Connected){exit 1}}catch{}finally{$c.Dispose()};exit 0" >nul 2>nul
if errorlevel 1 (
 echo Навигатор ещё работает. Закрой окно сервера и запусти обновление снова.
 pause
 exit /b 1
)
echo Скачиваем обновление с GitHub...
powershell.exe -NoLogo -NoProfile -Command "$ErrorActionPreference='Stop'; $app=$env:ZN_APP; $tmp=Join-Path $env:TEMP ('zemlya-update-'+[guid]::NewGuid()); New-Item -ItemType Directory -Path $tmp | Out-Null; try { $archive=Join-Path $tmp 'update.zip'; Invoke-WebRequest -Uri 'https://codeload.github.com/ovt10312-bit/zemlya-v-raschete/zip/refs/heads/navigator-app' -OutFile $archive -UseBasicParsing; Expand-Archive -LiteralPath $archive -DestinationPath $tmp; $source=Join-Path $tmp 'zemlya-v-raschete-navigator-app\navigator'; if(!(Test-Path (Join-Path $source 'package.json'))){throw 'Неполный архив обновления'}; if(Test-Path (Join-Path $app '.data')){ $backup=Join-Path $app ('.data-backups\'+(Get-Date -Format 'yyyyMMdd-HHmmss')); New-Item -ItemType Directory -Path $backup -Force | Out-Null; Copy-Item -LiteralPath (Join-Path $app '.data') -Destination $backup -Recurse -Force }; Get-ChildItem -LiteralPath $source -Force | Where-Object { $_.Name -notin @('.data','.data-backups','node_modules','dist','Update-Navigator.cmd') } | Copy-Item -Destination $app -Recurse -Force; } finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }"
if errorlevel 1 (
 echo Не удалось скачать или распаковать обновление. Данные кабинета не удалены.
 pause
 exit /b 1
)
cd /d "%ZN_APP%"
echo Устанавливаем компоненты...
call npm.cmd ci
if errorlevel 1 goto update_error
echo Собираем программу...
call npm.cmd run build
if errorlevel 1 goto update_error
echo Обновление завершено. Сейчас откроем Навигатор.
if exist "%ZN_APP%\Start-Navigator.cmd" (
 start "" "%ZN_APP%\Start-Navigator.cmd"
) else (
 start "Земля - сервер" /min /D "%ZN_APP%" cmd.exe /d /k "node server\local.mjs"
 timeout /t 3 /nobreak >nul
 start "" "http://127.0.0.1:8787/account/email"
)
echo Для настройки почты открой http://127.0.0.1:8787/account/email
pause
exit /b 0
:update_error
echo Обновление не завершено. Пришли скриншот этого окна. Папка .data сохранена.
pause
exit /b 1
