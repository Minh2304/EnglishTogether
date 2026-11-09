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
set "TEMP_REPO=%TEMP%\ET_repo_%RANDOM%"

echo Updating tools to the latest version...

call :FIND_GIT
if defined GIT_CMD (
    call :DOWNLOAD_VIA_GIT
) else (
    call :DOWNLOAD_VIA_ZIP
)

if not exist "!TEMP_REPO!\tools" (
    echo [ERROR] Failed to download tools from repository.
    if exist "!TEMP_REPO!" rd /s /q "!TEMP_REPO!" >nul 2>&1
    exit /b 1
)

:: Copy ONLY each tool folder inside tools\* directly into the current directory
for /d %%D in ("!TEMP_REPO!\tools\*") do (
    set "TOOL_NAME=%%~nxD"
    if exist "%WORK_DIR%\!TOOL_NAME!" (
        rd /s /q "%WORK_DIR%\!TOOL_NAME!" >nul 2>&1
    )
    xcopy "%%~fD" "%WORK_DIR%\!TOOL_NAME!\" /E /I /H /Y /Q >nul 2>&1
    echo   + !TOOL_NAME! [Updated]
)

:: Clean up temporary download folder
if exist "!TEMP_REPO!" rd /s /q "!TEMP_REPO!" >nul 2>&1

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


:DOWNLOAD_VIA_GIT
if exist "!TEMP_REPO!" rd /s /q "!TEMP_REPO!" >nul 2>&1
"!GIT_CMD!" clone --depth 1 --branch main "%REPO_URL%" "!TEMP_REPO!" -q >nul 2>&1
if errorlevel 1 (
    call :DOWNLOAD_VIA_ZIP
)
exit /b 0


:DOWNLOAD_VIA_ZIP
if exist "!TEMP_REPO!" rd /s /q "!TEMP_REPO!" >nul 2>&1
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
  "if ($sub) { Move-Item -Path $sub.FullName -Destination '!TEMP_REPO!' -Force }; " ^
  "Remove-Item $zip -Force -ErrorAction SilentlyContinue; " ^
  "Remove-Item $ext -Recurse -Force -ErrorAction SilentlyContinue;" >nul 2>&1
exit /b 0
