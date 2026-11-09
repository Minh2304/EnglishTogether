@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1
title EnglishTogether - Tool Manager ^& Auto Updater

:: ============================================================================
:: EnglishTogether.bat
:: - Tu dong tim Git tren may (PATH, Program Files, AppData, GitHub Desktop,
::   hoac Windows Registry) va neu may chua cai Git thi tu dong tai truc tiep
::   ban moi nhat tu GitHub qua PowerShell ZIP!
:: - Tu dong quet thu muc "tools\" de liet ke va khoi chay bat ky tool nao moi
::   ma khong can chinh sua hay nang cap file .bat nay trong tuong lai.
:: ============================================================================

set "REPO_URL=https://github.com/Minh2304/EnglishTogether.git"
set "REPO_ZIP_URL=https://github.com/Minh2304/EnglishTogether/archive/refs/heads/main.zip"
set "WORK_DIR=%~dp0"
if "%WORK_DIR:~-1%"=="\" set "WORK_DIR=%WORK_DIR:~0,-1%"
cd /d "%WORK_DIR%"

:: Dam bao System32 luon co trong PATH
set "PATH=%PATH%;%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\Wbem;%SystemRoot%\System32\WindowsPowerShell\v1.0"

echo ============================================================================
echo              ENGLISH TOGETHER - TOOL DOWNLOADER ^& UPDATER
echo ============================================================================
echo Repository : %REPO_URL%
echo Working Dir: %CD%
echo.

:: Buoc 1: Tim Git tren may va dong bo tat ca cac tool len version moi nhat
call :FIND_GIT
call :SYNC_REPO_LATEST

:: Neu chay voi tham so --update thi thoat ngay sau khi cap nhat xong
if /i "%~1"=="--update" (
    echo.
    echo [DONE] Updated all tools to the latest version!
    exit /b 0
)

:MAIN_MENU
echo.
echo ============================================================================
echo                    AVAILABLE TOOLS IN REPOSITORY
echo ============================================================================

set /a TOOL_COUNT=0
if exist "%CD%\tools" (
    for /d %%D in ("%CD%\tools\*") do (
        set /a TOOL_COUNT+=1
        set "CURRENT_TYPE=Folder"

        if exist "%%~fD\manifest.json" (
            set "CURRENT_TYPE=Chrome/Edge Extension"
        ) else if exist "%%~fD\run.bat" (
            set "CURRENT_TYPE=Batch Tool - run.bat"
        ) else if exist "%%~fD\start.bat" (
            set "CURRENT_TYPE=Batch Tool - start.bat"
        ) else if exist "%%~fD\main.py" (
            set "CURRENT_TYPE=Python Tool - main.py"
        ) else if exist "%%~fD\package.json" (
            set "CURRENT_TYPE=Node.js Tool"
        )

        set "TOOL_PATH_!TOOL_COUNT!=%%~fD"
        set "TOOL_NAME_!TOOL_COUNT!=%%~nxD"
        set "TOOL_TYPE_!TOOL_COUNT!=!CURRENT_TYPE!"

        echo   [!TOOL_COUNT!] %%~nxD  --  [!CURRENT_TYPE!]
    )
)

if !TOOL_COUNT! EQU 0 (
    echo   No tools found in tools\ directory.
)

echo ----------------------------------------------------------------------------
echo   [U] Update all tools to latest version now
echo   [O] Open tools folder in Windows Explorer
echo   [0] Exit
echo ============================================================================
set "CHOICE="
set /p "CHOICE=Select option (1-!TOOL_COUNT!, U, O, 0): " || exit /b 0
set "CHOICE=!CHOICE: =!"

if /i "!CHOICE!"=="0" exit /b 0
if /i "!CHOICE!"=="U" (
    call :SYNC_REPO_LATEST
    goto MAIN_MENU
)
if /i "!CHOICE!"=="O" (
    explorer "%CD%"
    goto MAIN_MENU
)

set /a SELECTED_NUM=!CHOICE! 2>nul
if !SELECTED_NUM! GEQ 1 if !SELECTED_NUM! LEQ !TOOL_COUNT! (
    call :LAUNCH_TOOL "!SELECTED_NUM!"
    goto MAIN_MENU
)

echo [!] Invalid choice, please try again.
goto MAIN_MENU


:: ============================================================================
:: TIM KIEM GIT.EXE TREN TOAN BO MAY TINH (KE CA KHI KHONG CO TRONG PATH)
:: ============================================================================
:FIND_GIT
set "GIT_CMD="

:: 1. Thu goi truc tiep git trong PATH hien tai
git --version >nul 2>&1
if not errorlevel 1 (
    set "GIT_CMD=git"
    exit /b 0
)

:: 2. Kiem tra cac thu muc cai dat Git pho bien tren Windows
for %%P in (
    "%ProgramFiles%\Git\cmd\git.exe"
    "%ProgramFiles%\Git\bin\git.exe"
    "%ProgramFiles(x86)%\Git\cmd\git.exe"
    "%ProgramFiles(x86)%\Git\bin\git.exe"
    "%LocalAppData%\Programs\Git\cmd\git.exe"
    "%LocalAppData%\Programs\Git\bin\git.exe"
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

:: 3. Tim trong Windows Registry (GitForWindows)
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

:: 4. Tim trong GitHub Desktop neu nguoi dung cai GitHub Desktop
if exist "%LocalAppData%\GitHubDesktop" (
    for /d %%G in ("%LocalAppData%\GitHubDesktop\app-*") do (
        if exist "%%~fG\resources\app\git\cmd\git.exe" (
            set "GIT_CMD=%%~fG\resources\app\git\cmd\git.exe"
            set "PATH=!PATH!;%%~fG\resources\app\git\cmd"
            exit /b 0
        )
    )
)

exit /b 0


:: ============================================================================
:: DONG BO REPO VE VERSION MOI NHAT (UU TIEN GIT, FALLBACK POWERSHELL ZIP)
:: ============================================================================
:SYNC_REPO_LATEST
if defined GIT_CMD goto SYNC_USING_GIT
goto SYNC_USING_POWERSHELL_ZIP

:SYNC_USING_GIT
echo [SYNC] Found Git: "!GIT_CMD!"
echo [SYNC] Downloading/updating all tools to the latest version...

if not exist "%CD%\.git" (
    "!GIT_CMD!" init >nul 2>&1
    "!GIT_CMD!" remote remove origin >nul 2>&1
    "!GIT_CMD!" remote add origin "%REPO_URL%"
) else (
    "!GIT_CMD!" remote set-url origin "%REPO_URL%" >nul 2>&1 || "!GIT_CMD!" remote add origin "%REPO_URL%" >nul 2>&1
)

"!GIT_CMD!" fetch --all --prune
if errorlevel 1 (
    echo [WARN] Git fetch failed, switching to direct GitHub ZIP download...
    goto SYNC_USING_POWERSHELL_ZIP
)

"!GIT_CMD!" checkout -B main origin/main >nul 2>&1
"!GIT_CMD!" reset --hard origin/main >nul 2>&1
if errorlevel 1 (
    "!GIT_CMD!" checkout -B master origin/master >nul 2>&1
    "!GIT_CMD!" reset --hard origin/master >nul 2>&1
)

echo [OK] All tools are now at the latest version via Git!
exit /b 0

:SYNC_USING_POWERSHELL_ZIP
echo [SYNC] Downloading latest tools directly from GitHub Archive...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop'; " ^
  "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
  "$zipPath = Join-Path $env:TEMP 'EnglishTogether_latest.zip'; " ^
  "$extractDir = Join-Path $env:TEMP 'EnglishTogether_extract'; " ^
  "if (Test-Path $zipPath) { Remove-Item $zipPath -Force }; " ^
  "if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }; " ^
  "Invoke-WebRequest -Uri '%REPO_ZIP_URL%' -OutFile $zipPath -UseBasicParsing; " ^
  "Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force; " ^
  "$subFolder = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1; " ^
  "if ($subFolder) { Copy-Item -Path (Join-Path $subFolder.FullName '*') -Destination '%CD%' -Recurse -Force }; " ^
  "Remove-Item $zipPath -Force -ErrorAction SilentlyContinue; " ^
  "Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue;"

if errorlevel 1 (
    echo [ERROR] Could not download latest version from GitHub. Please check your internet connection.
) else (
    echo [OK] All tools downloaded and updated to the latest version!
)
exit /b 0


:: ============================================================================
:: HAM KHOI CHAY / CAI DAT TOOL TU DONG THEO LOAI TOOL
:: ============================================================================
:LAUNCH_TOOL
set "IDX=%~1"
for /f "tokens=*" %%N in ("!TOOL_NAME_%IDX%!") do set "T_NAME=%%N"
for /f "tokens=*" %%P in ("!TOOL_PATH_%IDX%!") do set "T_PATH=%%P"
for /f "tokens=*" %%T in ("!TOOL_TYPE_%IDX%!") do set "T_TYPE=%%T"

echo.
echo ----------------------------------------------------------------------------
echo Tool : !T_NAME! [!T_TYPE!]
echo Path : !T_PATH!
echo ----------------------------------------------------------------------------

if exist "!T_PATH!\run.bat" (
    pushd "!T_PATH!"
    call run.bat
    popd
    exit /b 0
)
if exist "!T_PATH!\start.bat" (
    pushd "!T_PATH!"
    call start.bat
    popd
    exit /b 0
)

if exist "!T_PATH!\manifest.json" (
    echo !T_PATH!| clip
    echo [OK] Extension folder path copied to Clipboard:
    echo      !T_PATH!
    echo.
    echo How to load/update Extension in Chrome or Edge:
    echo   1. Open browser at: chrome://extensions  or  edge://extensions
    echo   2. Enable "Developer mode" at top-right.
    echo   3. Click "Load unpacked" and paste [Ctrl+V] the path above.
    echo      If already installed, just click Reload on the Extension card!
    echo.
    explorer "!T_PATH!"
    pause
    exit /b 0
)

if exist "!T_PATH!\main.py" (
    pushd "!T_PATH!"
    if exist "requirements.txt" (
        pip install -r requirements.txt
    )
    python main.py
    popd
    pause
    exit /b 0
)

if exist "!T_PATH!\package.json" (
    pushd "!T_PATH!"
    if not exist "node_modules" (
        call npm install
    )
    call npm start
    popd
    pause
    exit /b 0
)

explorer "!T_PATH!"
exit /b 0
