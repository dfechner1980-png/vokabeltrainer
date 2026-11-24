FROM python:3.12-slim

LABEL org.opencontainers.image.source="https://github.com/dfechner1980-png/vokabeltrainer" \
      org.opencontainers.image.description="Vokabeltrainer – Deutsch nach Englisch üben"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DB_PATH=/data/vokabeln.db \
    PUID=99 \
    PGID=100 \
    TZ=Europe/Berlin

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')" || exit 1

# Startet als root, setzt Rechte auf /data und läuft dann als PUID/PGID
CMD ["python", "-m", "app.run"]
