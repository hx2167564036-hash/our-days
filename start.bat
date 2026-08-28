@echo off
chcp 65001 >nul
title 我们的日子 - 本地服务
echo ============================================
echo   正在启动「我们的日子」服务...
echo   启动成功后，用浏览器打开：
echo       http://localhost:8000
echo   如果打不开，试试 http://172.26.105.192:8000
echo   关闭本窗口 = 停止服务
echo ============================================
wsl --cd "C:\Users\kendle\our-days" python3 server.py
pause
