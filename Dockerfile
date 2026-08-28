FROM python:3.12-slim

WORKDIR /app

# 复制项目文件
COPY server.py ./
COPY static/ ./static/

# 数据目录（可挂载卷持久化）
RUN mkdir -p /app/data

EXPOSE 8000

# 把数据库放到可挂载的 /app/data 目录
ENV OURDAYS_DB=/app/data/data.db

CMD ["python3", "server.py"]
