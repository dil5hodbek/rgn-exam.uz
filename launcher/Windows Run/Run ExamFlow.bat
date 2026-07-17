@echo off
setlocal EnableExtensions EnableDelayedExpansion
title ExamFlow - Ishga tushirish

rem Bu fayl launcher\Windows Run ichida, loyiha ildizidan ikki papka pastda.
for %%I in ("%~dp0..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"

echo ============================================================
echo                  ExamFlow - Windows Launcher
echo ============================================================
echo Loyiha: %PROJECT_ROOT%
echo.

rem --- 1. Docker bormi ---
where docker >nul 2>&1
if errorlevel 1 (
    echo [XATO] Docker Desktop o'rnatilmagan yoki PATH da yo'q.
    echo Docker Desktop ni o'rnating va bu faylni qayta ishga tushiring.
    goto :failed
)

rem --- 2. Docker engine ishlayaptimi ---
docker info >nul 2>&1
if not errorlevel 1 goto :docker_ready

echo [INFO] Docker Desktop ishlamayapti. Ishga tushirilmoqda...
set "DD=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
if not exist "!DD!" set "DD=%LocalAppData%\Docker\Docker Desktop.exe"
if not exist "!DD!" (
    echo [XATO] Docker Desktop.exe topilmadi. Uni qo'lda ishga tushiring.
    goto :failed
)
start "" "!DD!"

echo [KUTISH] Docker engine tayyor bo'lishini kutmoqda (2 daqiqagacha)...
set /a DOCKER_TRIES=0
:wait_for_docker
timeout /t 3 /nobreak >nul
docker info >nul 2>&1
if not errorlevel 1 goto :docker_ready
set /a DOCKER_TRIES+=1
if %DOCKER_TRIES% LSS 40 (
    echo    ...hali tayyor emas ^(%DOCKER_TRIES%/40^)
    goto :wait_for_docker
)
echo [XATO] Docker 2 daqiqada tayyor bo'lmadi. Docker Desktop ni tekshiring.
goto :failed

:docker_ready
echo [OK] Docker tayyor.
echo.

rem --- 3. .env fayli ---
if not exist ".env" (
    if not exist ".env.example" (
        echo [XATO] .env.example topilmadi.
        goto :failed
    )
    copy /y ".env.example" ".env" >nul
    echo [OK] .env fayli .env.example dan yaratildi.
    echo      Diqqat: TELEGRAM va OPENROUTER kalitlarini .env ga qo'ying.
)

rem --- 4. Servislarni qurish va ishga tushirish ---
echo [INFO] ExamFlow servislari qurilmoqda va ishga tushirilmoqda...
echo        Birinchi marta image yuklab olinadi - bir necha daqiqa ketishi mumkin.
docker compose up --build -d
if errorlevel 1 (
    echo [XATO] Loyiha ishga tushmadi. Holat:
    docker compose ps
    goto :failed
)

rem --- 5. Web ilova tayyor bo'lishini kutish ---
echo [KUTISH] Web ilova va API tayyor bo'lishini kutmoqda...
set /a APP_TRIES=0
:wait_for_app
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://localhost:13000'; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } } catch {}; exit 1" >nul 2>&1
if not errorlevel 1 goto :app_ready
set /a APP_TRIES+=1
if %APP_TRIES% GEQ 60 goto :app_timeout
timeout /t 3 /nobreak >nul
goto :wait_for_app

:app_ready
echo.
echo ============================================================
echo   [MUVAFFAQIYAT] ExamFlow to'liq ishlayapti!
echo ============================================================
echo   Web sayt : http://localhost:13000
echo   API hujjat: http://localhost:18000/docs
echo ============================================================
echo.
docker compose ps
echo.
start "" "http://localhost:13000"
echo Bu oynani yopsangiz ham loyiha Docker ichida ishlab turaveradi.
echo To'xtatish uchun: "Stop ExamFlow.bat" ni ishga tushiring.
echo Internetga ulashish uchun: "Share Online.bat" ni ishga tushiring.
echo.
pause
exit /b 0

:app_timeout
echo [XATO] Konteynerlar ishga tushdi, lekin web ilova 3 daqiqada tayyor bo'lmadi.
echo Holat va oxirgi loglar:
docker compose ps
docker compose logs --tail 50
goto :failed

:failed
echo.
echo ExamFlow to'liq ishga tushmadi. Yuqoridagi xabarlarni tekshiring.
pause
exit /b 1
