# S2 — Personagens. Contexto de build = RAIZ do monorepo (para copiar contracts/ e infra/manifests/):
#   docker build -f services/characters/Dockerfile -t rpg-nexus/characters .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY services/characters/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY contracts/ /app/contracts/
COPY infra/manifests/characters.json /app/infra/manifests/characters.json
COPY services/characters/app/ /app/app/
COPY services/characters/scripts/ /app/scripts/

ENV CONTRACTS_DIR=/app/contracts \
    MANIFEST_PATH=/app/infra/manifests/characters.json

RUN useradd --system --uid 10001 --no-create-home appuser
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)" || exit 1

CMD ["uvicorn", "--factory", "app.main:create_app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--timeout-graceful-shutdown", "10"]
