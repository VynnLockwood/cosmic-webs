"""Background schema imports: start returns the parsed graph at once, progress is polled by job id."""
import threading
import uuid

from .ddl import parse_ddl
from .sandbox import rebuild_sandbox_report
from .sources import registry

# stage -> (from %, to %) of the whole job
STAGES = {"Resetting sandbox": (0, 5), "Creating tables": (5, 25), "Loading rows": (25, 90), "Finishing": (90, 100)}

_lock = threading.Lock()
_jobs: dict[str, dict] = {}
MAX_KEPT = 20


def reset_for_tests() -> None:
    for t in threading.enumerate():
        if t.name.startswith("import-"):
            t.join(30)  # let a running import finish; never force the lock open under it
    _jobs.clear()


def busy() -> bool:
    return _lock.locked()


def build_sandbox(ddl: str, graph, use_dump_data: bool, progress):
    return rebuild_sandbox_report(ddl, graph, use_dump_data=use_dump_data, progress=progress)


def get(job_id: str) -> dict | None:
    j = _jobs.get(job_id)
    return dict(j) if j else None


def start(ddl: str, use_dump_data: bool = True, is_default: bool = False):
    """Parse now (DdlError propagates, no job), then build in a thread. Returns (job_id, parsed) or None when busy."""
    parsed = parse_ddl(ddl)
    if not _lock.acquire(blocking=False):
        return None
    job_id = uuid.uuid4().hex[:12]
    job = {"id": job_id, "status": "running", "stage": "Starting", "message": "", "percent": 0, "result": None, "error": None}
    _jobs[job_id] = job
    while len(_jobs) > MAX_KEPT:
        _jobs.pop(next(iter(_jobs)))

    def progress(stage, frac, msg=""):
        lo, hi = STAGES.get(stage, (0, 100))
        job["percent"] = max(job["percent"], min(99, int(lo + frac * (hi - lo))))
        job["stage"], job["message"] = stage, msg

    def run():
        try:
            rep = build_sandbox(ddl, parsed.graph, use_dump_data, progress)
            parsed.graph = rep.graph
            parsed.warnings.extend(rep.warnings)
            registry.use_sandbox()
            registry.graph = rep.graph
            registry.data_source = rep.data_source
            out = parsed.model_dump(by_alias=True)
            out["data"] = {"source": rep.data_source, "rows_loaded": rep.rows_loaded, "tables_with_data": rep.tables_with_data, "tables_empty": rep.tables_empty}
            out["graph"], out["warnings"] = rep.graph.model_dump(by_alias=True), parsed.warnings
            job.update(result=out, percent=100, stage="Done", status="done")
        except Exception as e:  # never leave the client polling forever
            job.update(status="error", error=f"{type(e).__name__}: {e}")
        finally:
            _lock.release()

    threading.Thread(target=run, daemon=True, name=f"import-{job_id}").start()
    return job_id, parsed
