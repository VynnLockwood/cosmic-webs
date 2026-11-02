from fastapi import FastAPI

app = FastAPI(title="cosmic-webs")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
