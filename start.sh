#!/bin/bash
# 在 WSL 终端里运行：bash start.sh
cd "$(dirname "$0")"
echo "启动「我们的日子」服务，按 Ctrl+C 停止..."
python3 server.py
