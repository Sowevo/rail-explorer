FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    RAIL_DATA_DIR=/data
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/rail
COPY requirements.txt requirements-docker.txt ./
RUN pip install --no-cache-dir -r requirements-docker.txt && python -c "import osmium, gunicorn"
COPY app ./app
# 提交号只影响版本信息，不使系统库和 Python 依赖层失效。
ARG REVISION=local
LABEL org.opencontainers.image.source="https://github.com/Sowevo/rail-explorer" \
      org.opencontainers.image.revision=$REVISION
ENV RAIL_REVISION=$REVISION
EXPOSE 5050
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5050/health', timeout=4)"
ENTRYPOINT ["python", "/opt/rail/app/container_cli.py"]
CMD ["serve"]
