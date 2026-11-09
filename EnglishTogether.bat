@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1
title EnglishTogether - Tool Manager ^& Auto Updater

:: ============================================================================
:: EnglishTogether.bat
:: - Tu dong tai (clone) hoac cap nhat (pull) TAT CA cac tool trong Git repo
:: - Tu dong quet thu muc "tools\" de liet ke va khoi chay bat ky tool nao moi
::   ma khong can chinh sua hay nang cap file .bat nay trong tuong lai.
:: ============================================================================

set "REPO_URL=https://github.com/Minh2304/EnglishTogether.git"
set "WORK_DIR=%~dp0"
if "%WORK_DIR:~-1%"=="\" set "WORK_DIR=%WORK_DIR:~0,-1%"
cd /d "%WORK_DIR%"

echo ============================================================================
echo              ENGLISH TOGETHER - TOOL DOWNLOADER ^& UPDATER
echo ============================================================================
echo Repository: %REPO_URL%
echo Thu muc hien tai: %CD%
echo.

:: Kiem tra Git da duoc cai dat hay chua
where git >nul 2>&1
if errorlevel 1 (
    echo [LOI] May tinh chua cai dat Git hoac Git chua co trong PATH.
    echo Vui long tai va cai dat Git tai: https://git-scm.com/downloads
    pause
    exit /b 1
)

:: Buoc 1: Tai moi hoac Cap nhat tat ca cac tool tu Git
call :SYNC_GIT_REPO

:: Neu chay voi tham so --update thi thoat ngay sau khi cap nhat xong
if /i "%~1"=="--update" (
    echo.
    echo [HOAN TAT] Da kiem tra va cap nhat tat ca cac tool tu Git!
    exit /b 0
)

:MAIN_MENU
echo.
echo ============================================================================
echo                    DANH SACH CAC TOOL TRONG REPOSITORY
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
    echo   Chua co tool nao trong thu muc tools\
)

echo ----------------------------------------------------------------------------
echo   [U] Update tat ca cac tool tu Git ngay bay gio [git pull]
echo   [O] Mo thu muc chua toan bo Tool trong Windows Explorer
echo   [0] Thoat
echo ============================================================================
set "CHOICE="
set /p "CHOICE=Nhap lua chon cua ban (1-!TOOL_COUNT!, U, O, 0): " || exit /b 0
set "CHOICE=!CHOICE: =!"

if /i "!CHOICE!"=="0" exit /b 0
if /i "!CHOICE!"=="U" (
    call :SYNC_GIT_REPO
    goto MAIN_MENU
)
if /i "!CHOICE!"=="O" (
    explorer "%CD%"
    goto MAIN_MENU
)

:: Kiem tra lua chon so thu tu tool
set /a SELECTED_NUM=!CHOICE! 2>nul
if !SELECTED_NUM! GEQ 1 if !SELECTED_NUM! LEQ !TOOL_COUNT! (
    call :LAUNCH_TOOL "!SELECTED_NUM!"
    goto MAIN_MENU
)

echo [!] Lua chon khong hop le, vui long thu lai.
goto MAIN_MENU


:: ============================================================================
:: HAM DONG BO GIT: Tu dong Clone neu chua co .git, hoac Pull tat ca tool moi
:: ============================================================================
:SYNC_GIT_REPO
echo [GIT] Dang kiem tra va dong bo tat ca cac tool tu GitHub...
if exist "%CD%\.git" goto GIT_UPDATE_EXISTING

echo [GIT] Chua phat hien Git repo tai thu muc nay. Dang khoi tao va tai toan bo repo...
git init
git remote remove origin >nul 2>&1
git remote add origin "%REPO_URL%"
git fetch --all
git checkout -B main origin/main 2>nul || git checkout -B master origin/master 2>nul
if errorlevel 1 (
    echo [THONG BAO] Repo tren GitHub co the chua co commit nao hoac can push code len truoc.
) else (
    echo [OK] Da tai thanh cong tat ca cac tool tu Git!
)
exit /b 0

:GIT_UPDATE_EXISTING
git remote get-url origin >nul 2>&1
if errorlevel 1 (
    git remote add origin "%REPO_URL%"
)
git fetch --all --prune 2>nul
git pull --rebase --autostash origin main 2>nul || git pull --rebase --autostash origin master 2>nul
if errorlevel 1 (
    echo [THONG BAO] Repo local dang o trang thai moi nhat hoac remote chua co nhanh main.
) else (
    echo [OK] Tat ca cac tool trong repo da duoc cap nhat len phien ban moi nhat!
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
echo Dang mo tool: !T_NAME! [!T_TYPE!]
echo Duong dan   : !T_PATH!
echo ----------------------------------------------------------------------------

:: 1. Neu tool co file run.bat hoac start.bat rieng -> uu tien chay
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

:: 2. Neu la Chrome / Edge Extension (co manifest.json)
if exist "!T_PATH!\manifest.json" (
    echo !T_PATH!| clip
    echo [OK] Da SAO CHEP duong dan Extension vao Clipboard:
    echo      !T_PATH!
    echo.
    echo Huong dan nap/cap nhat Extension vao Chrome hoac Edge:
    echo   1. Mo trinh duyet tai dia chi: chrome://extensions  hoac  edge://extensions
    echo   2. Bat che do "Developer mode" o goc phai tren.
    echo   3. Nhan "Load unpacked" va dan [Ctrl+V] duong dan tren.
    echo      Neu da cai truoc do, chi can nhan nut Reload tren the Extension!
    echo.
    explorer "!T_PATH!"
    pause
    exit /b 0
)

:: 3. Neu la Python Tool (co main.py)
if exist "!T_PATH!\main.py" (
    pushd "!T_PATH!"
    if exist "requirements.txt" (
        echo Dang kiem tra thu vien Python...
        pip install -r requirements.txt
    )
    python main.py
    popd
    pause
    exit /b 0
)

:: 4. Neu la Node.js Tool (co package.json)
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

:: 5. Mac dinh mo thu muc tool
explorer "!T_PATH!"
exit /b 0
