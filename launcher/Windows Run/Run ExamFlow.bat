@echo off
setlocal EnableExtensions
title ExamFlow - Windows Launcher

rem This file lives in launcher\Windows Run, two levels below the project root.
for %%I in ("%~dp0..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"

echo ============================================================
echo                  ExamFlow Windows Launcher
echo ============================================================
echo.

where docker >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker Desktop is not installed or docker.exe is not in PATH.
    echo Install Docker Desktop, then run this file again.
    goto :failed
)

docker info >nul 2>&1
if not errorlevel 1 goto :docker_ready

echo [INFO] Docker Desktop is not running. Starting it now...
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" goto :start_docker_programfiles
if exist "%LocalAppData%\Docker\Docker Desktop.exe" goto :start_docker_localappdata
echo [ERROR] Docker Desktop could not be started automatically.
echo Start Docker Desktop manually, then run this file again.
goto :failed

:start_docker_programfiles
start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
goto :wait_for_docker_begin

:start_docker_localappdata
start "" "%LocalAppData%\Docker\Docker Desktop.exe"

:wait_for_docker_begin
echo [WAIT] Waiting for the Docker engine...
set /a DOCKER_TRIES=0
:wait_for_docker
timeout /t 3 /nobreak >nul
docker info >nul 2>&1
if not errorlevel 1 goto :docker_ready
set /a DOCKER_TRIES+=1
if %DOCKER_TRIES% LSS 40 goto :wait_for_docker
echo [ERROR] Docker did not become ready within 2 minutes.
goto :failed

:docker_ready
echo [OK] Docker is ready.

if not exist ".env" (
    if not exist ".env.example" (
        echo [ERROR] .env.example was not found in "%PROJECT_ROOT%".
        goto :failed
    )
    copy /y ".env.example" ".env" >nul
    echo [OK] Created .env from .env.example.
)

echo [INFO] Building and starting all ExamFlow services...
echo [INFO] The first run downloads images and builds the app - this can take
echo        several minutes. Later runs are much faster.
docker compose up --build -d
if errorlevel 1 (
    echo [ERROR] The project could not be started.
    echo.
    docker compose ps
    goto :failed
)

echo [WAIT] Waiting for the web application and API...
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
echo [SUCCESS] ExamFlow is fully running.
echo [WEB]     http://localhost:13000
echo [API]     http://localhost:18000/docs
echo.
docker compose ps
echo.
start "" "http://localhost:13000"
echo You may close this window; the project will keep running in Docker.
echo To stop it later, run: docker compose down
pause
exit /b 0

:app_timeout
echo [ERROR] Containers started, but the web app was not ready within 3 minutes.
echo Check the service status and recent logs below:
docker compose ps
docker compose logs --tail 50

:failed
echo.
echo ExamFlow was not started successfully.
pause
exit /b 1
