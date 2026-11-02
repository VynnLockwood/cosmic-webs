from fastapi import FastAPI

from .routes_schema import router as schema_router

app = FastAPI(title="cosmic-webs")
app.include_router(schema_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
