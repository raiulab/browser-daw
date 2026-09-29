@echo off
chcp 65001 >nul 2>&1
rem ===================================================================
rem  Browser DAW  -  Windows launcher
rem  フォルダごとコピーして、このファイルを実行するだけで起動します。
rem  インストール・ネット接続・追加ランタイムは一切不要です。
rem ===================================================================
setlocal
title Browser DAW

set "HERE=%~dp0"
set "PAGE=%HERE%index.html"

if not exist "%PAGE%" (
  echo.
  echo   [ERROR] index.html が見つかりません:
  echo           "%PAGE%"
  echo           フォルダごとコピーしたか確認してください。
  echo.
  pause
  exit /b 1
)

rem --- file:/// 形式の URL を作る (バックスラッシュ→スラッシュ) ------
set "FWD=%PAGE:\=/%"
set "PAGEURL=file:///%FWD%"

rem --- アプリウィンドウ用のユーザープロファイル ----------------------
set "PROFILE=%LOCALAPPDATA%\BrowserDAW\profile"

echo.
echo   ==========================================
echo      Browser DAW
echo      Professional Music Production
echo   ==========================================
echo.

rem --- Chrome / Edge を探す (アプリモード起動用) ---------------------
set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe"      set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe"      set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"     set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"

if defined BROWSER (
  echo   起動中: "%BROWSER%"
  start "" "%BROWSER%" --app="%PAGEURL%" --user-data-dir="%PROFILE%" --window-size=1600,980 --autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-features=CalculateNativeWinOcclusion --allow-file-access-from-files
  echo   Browser DAW を起動しました。ウィンドウを閉じると終了します。
) else (
  echo   Chrome / Edge が見つからないため、既定のブラウザで開きます。
  start "" "%PAGE%"
)

echo.
timeout /t 3 >nul
exit /b 0
