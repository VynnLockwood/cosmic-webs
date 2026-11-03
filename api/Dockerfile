FROM python:3.12-slim
WORKDIR /srv
# pg_dump 16 (same major as the sandbox database) powers the structure lab export
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
 && rm -rf /var/lib/apt/lists/*
COPY api/pyproject.toml ./
RUN pip install --no-cache-dir -e ".[dev]" || pip install --no-cache-dir fastapi "uvicorn[standard]" pglast "psycopg[binary]" faker httpx
COPY api/app ./app
COPY samples /samples
ENV SAMPLES_DIR=/samples SANDBOX_DSN=postgresql://cosmos:cosmos@sandbox-pg:5432/cosmos
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
