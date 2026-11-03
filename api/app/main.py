from fastapi import FastAPI

from .routes_data import router as data_router
from .routes_query import router as query_router
from .routes_schema import router as schema_router
from .routes_structure import router as structure_router

app = FastAPI(title="cosmic-webs")
app.include_router(schema_router)
app.include_router(data_router)
app.include_router(query_router)
app.include_router(structure_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
