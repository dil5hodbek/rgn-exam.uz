@echo off
setlocal EnableExtensions EnableDelayedExpansion
title ExamFlow - Toza qayta qurish

rem Bu fayl launcher\Windows Run ichida, loyiha ildizidan ikki papka pastda.
for %%I in ("%~dp0..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"

echo ============================================================
echo            ExamFlow - Toza qayta qurish (Clean Rebuild)
echo ============================================================
echo Loyiha: %PROJECT_ROOT%
echo.
echo Bu skript:
echo   - Eski konteynerlarni to'xtatadi
echo   - Eski Docker image'larni o'chiradi (kod qayta build qilinadi)
echo   - Ma'lumotlar bazasini (testlar, javoblar) SAQLAB QOLADI
echo   - Faqat mahalliy (localhost) ishga tushadi - internetga chiqmaydi
echo.
set /p CONFIRM="Davom etasizmi? (H/Y - ha, boshqa tugma - bekor qilish): "
if /i not "%CONFIRM%"=="H" if /i not "%CONFIRM%"=="Y" (
    echo Bekor qilindi.
    pause
    exit /b 0
)
echo.

rem --- 1. Docker bormi ---
where docker >nul 2>&1
if errorlevel 1 (
    echo [XATO] Docker Desktop o'rnatilmagan yoki PATH da yo'q.
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
echo [XATO] Docker 2 daqiqada tayyor bo'lmadi.
goto :failed

:docker_ready
echo [OK] Docker tayyor.
echo.

rem --- 3. Eski konteynerlarni to'xtatish (volume/baza tegilmaydi) ---
echo [1/4] Eski konteynerlar to'xtatilmoqda...
docker compose down
echo.

rem --- 4. Eski image'larni o'chirish (faqat shu loyihaniki) ---
echo [2/4] Eski ExamFlow image'lari o'chirilmoqda...
for /f "tokens=*" %%i in ('docker images --filter "reference=examflow-*" -q 2^>nul') do docker rmi -f %%i >nul 2>&1
echo [OK] Eski image'lar tozalandi.
echo.

rem --- 5. .env fayli ---
if not exist ".env" (
    if not exist ".env.example" (
        echo [XATO] .env.example topilmadi.
        goto :failed
    )
    copy /y ".env.example" ".env" >nul
    echo [OK] .env fayli .env.example dan yaratildi.
)

rem --- 6. Keshsiz qayta build va ishga tushirish ---
echo [3/4] Barcha servislar keshsiz (--no-cache) qayta qurilmoqda...
echo        Bu bir necha daqiqa vaqt olishi mumkin.
docker compose build --no-cache
if errorlevel 1 (
    echo [XATO] Build muvaffaqiyatsiz tugadi.
    goto :failed
)

echo [4/4] Servislar ishga tushirilmoqda...
docker compose up -d
if errorlevel 1 (
    echo [XATO] Loyiha ishga tushmadi. Holat:
    docker compose ps
    goto :failed
)

rem --- 7. Web ilova tayyor bo'lishini kutish ---
echo.
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
echo   [MUVAFFAQIYAT] ExamFlow toza holda qayta qurildi va ishlayapti!
echo ============================================================
echo   Web sayt : http://localhost:13000
echo   API hujjat: http://localhost:18000/docs
echo   Ma'lumotlar bazasi: saqlanib qoldi (testlar, javoblar joyida)
echo   Rejim: faqat mahalliy - internetga ulanmagan
echo ============================================================
echo.
docker compose ps
echo.
start "" "http://localhost:13000"
echo Bu oynani yopsangiz ham loyiha Docker ichida ishlab turaveradi.
echo To'xtatish uchun: "Stop ExamFlow.bat" ni ishga tushiring.
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
echo Toza qayta qurish yakunlanmadi. Yuqoridagi xabarlarni tekshiring.
pause
exit /b 1
