@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1
title EnglishTogether Updater

set "REPO_URL=https://github.com/Minh2304/EnglishTogether.git"
set "REPO_ZIP_URL=https://github.com/Minh2304/EnglishTogether/archive/refs/heads/main.zip"
set "WORK_DIR=%~dp0"
if "%WORK_DIR:~-1%"=="\" set "WORK_DIR=%WORK_DIR:~0,-1%"
cd /d "%WORK_DIR%"

set "PATH=%PATH%;%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\Wbem;%SystemRoot%\System32\WindowsPowerShell\v1.0"

echo Updating tools to the latest version...

call :FIND_GIT
if defined GIT_CMD (
    call :SYNC_GIT
) else (
    call :SYNC_ZIP
)

if exist "%CD%\tools" (
    for /d %%D in ("%CD%\tools\*") do (
        echo   + %%~nxD [Updated]
    )
)

echo [OK] All tools are up to date.
exit /b 0


:FIND_GIT
set "GIT_CMD="
git --version >nul 2>&1
if not errorlevel 1 (
    set "GIT_CMD=git"
    exit /b 0
)
for %%P in (
    "%ProgramFiles%\Git\cmd\git.exe"
    "%ProgramFiles%\Git\bin\git.exe"
    "%ProgramFiles(x86)%\Git\cmd\git.exe"
    "%LocalAppData%\Programs\Git\cmd\git.exe"
    "%UserProfile%\scoop\apps\git\current\cmd\git.exe"
    "C:\Program Files\Git\cmd\git.exe"
    "C:\Program Files (x86)\Git\cmd\git.exe"
) do (
    if exist "%%~P" (
        set "GIT_CMD=%%~P"
        set "PATH=!PATH!;%%~dpP"
        exit /b 0
    )
)
for /f "tokens=2*" %%A in ('reg query "HKLM\SOFTWARE\GitForWindows" /v InstallPath 2^>nul') do (
    if exist "%%B\cmd\git.exe" (
        set "GIT_CMD=%%B\cmd\git.exe"
        set "PATH=!PATH!;%%B\cmd"
        exit /b 0
    )
)
for /f "tokens=2*" %%A in ('reg query "HKCU\SOFTWARE\GitForWindows" /v InstallPath 2^>nul') do (
    if exist "%%B\cmd\git.exe" (
        set "GIT_CMD=%%B\cmd\git.exe"
        set "PATH=!PATH!;%%B\cmd"
        exit /b 0
    )
)
exit /b 0


:SYNC_GIT
if not exist "%CD%\.git" (
    "!GIT_CMD!" init -q >nul 2>&1
    "!GIT_CMD!" remote remove origin >nul 2>&1
    "!GIT_CMD!" remote add origin "%REPO_URL%" >nul 2>&1
) else (
    "!GIT_CMD!" remote set-url origin "%REPO_URL%" >nul 2>&1 || "!GIT_CMD!" remote add origin "%REPO_URL%" >nul 2>&1
)

"!GIT_CMD!" fetch --all --prune -q >nul 2>&1
if errorlevel 1 (
    call :SYNC_ZIP
    exit /b 0
)

"!GIT_CMD!" checkout -B main origin/main -q >nul 2>&1
"!GIT_CMD!" reset --hard origin/main -q >nul 2>&1
exit /b 0


:SYNC_ZIP
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop'; " ^
  "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
  "$zip = Join-Path $env:TEMP 'ET_update.zip'; " ^
  "$ext = Join-Path $env:TEMP 'ET_extract'; " ^
  "if (Test-Path $zip) { Remove-Item $zip -Force }; " ^
  "if (Test-Path $ext) { Remove-Item $ext -Recurse -Force }; " ^
  "Invoke-WebRequest -Uri '%REPO_ZIP_URL%' -OutFile $zip -UseBasicParsing; " ^
  "Expand-Archive -Path $zip -DestinationPath $ext -Force; " ^
  "$sub = Get-ChildItem -Path $ext -Directory | Select-Object -First 1; " ^
  "if ($sub) { Copy-Item -Path (Join-Path $sub.FullName '*') -Destination '%CD%' -Recurse -Force }; " ^
  "Remove-Item $zip -Force -ErrorAction SilentlyContinue; " ^
  "Remove-Item $ext -Recurse -Force -ErrorAction SilentlyContinue;" >nul 2>&1

if errorlevel 1 (
    echo [ERROR] Update failed. Please check your internet connection.
    exit /b 1
)
exit /b 0
