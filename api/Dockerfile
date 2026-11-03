FROM python:3.12-slim
WORKDIR /srv
COPY api/pyproject.toml ./
RUN pip install --no-cache-dir -e ".[dev]" || pip install --no-cache-dir fastapi "uvicorn[standard]" pglast "psycopg[binary]" faker httpx
COPY api/app ./app
COPY samples /samples
ENV SAMPLES_DIR=/samples SANDBOX_DSN=postgresql://cosmos:cosmos@sandbox-pg:5432/cosmos
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
