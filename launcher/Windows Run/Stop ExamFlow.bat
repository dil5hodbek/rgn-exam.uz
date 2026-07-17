@echo off
setlocal EnableExtensions
title ExamFlow - To'xtatish

for %%I in ("%~dp0..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"

echo ============================================================
echo               ExamFlow - Servislarni to'xtatish
echo ============================================================
echo.

docker info >nul 2>&1
if errorlevel 1 (
    echo [INFO] Docker ishlamayapti - to'xtatadigan narsa yo'q.
    goto :done
)

echo [INFO] ExamFlow konteynerlari to'xtatilmoqda...
docker compose down
if errorlevel 1 (
    echo [XATO] To'xtatishda muammo bo'ldi.
    goto :end
)

echo.
echo [OK] Barcha ExamFlow servislari to'xtatildi.
echo      Ma'lumotlar bazasi (testlar, javoblar) saqlanib qoldi.
echo      Qayta ishga tushirish: "Run ExamFlow.bat".

:done
:end
echo.
pause
exit /b 0
