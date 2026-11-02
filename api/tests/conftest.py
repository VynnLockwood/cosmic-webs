"""Local Postgres 16 for tests (no Docker daemon needed)."""
import os
import shutil
import subprocess
import uuid
from pathlib import Path

import psycopg
import pytest

BIN = next(Path("/usr/lib/postgresql").glob("*/bin"), None)
PORT = 54329
ROOT = Path(__file__).resolve().parents[2]


def _run(args, **kw):
    if os.geteuid() == 0:
        args = ["runuser", "-u", "postgres", "--", *args]
    return subprocess.run(args, check=True, capture_output=True, text=True, **kw)


@pytest.fixture(scope="session")
def pg_server():
    if BIN is None:
        pytest.skip("postgres binaries not installed")
    base = Path("/tmp/cosmos_pgtest")
    shutil.rmtree(base, ignore_errors=True)
    base.mkdir()
    if os.geteuid() == 0:
        shutil.chown(base, "postgres", "postgres")
    data = base / "data"
    _run([str(BIN / "initdb"), "-D", str(data), "-A", "trust", "-U", "postgres"])
    _run([str(BIN / "pg_ctl"), "-D", str(data), "-w", "-l", str(base / "log"), "-o", f"-p {PORT} -k {base} -c listen_addresses=127.0.0.1", "start"])
    yield f"postgresql://postgres@127.0.0.1:{PORT}"
    _run([str(BIN / "pg_ctl"), "-D", str(data), "-m", "immediate", "stop"])
    shutil.rmtree(base, ignore_errors=True)


@pytest.fixture
def pg_dsn(pg_server):
    """A fresh empty database; returns its DSN."""
    name = "t_" + uuid.uuid4().hex[:10]
    with psycopg.connect(pg_server + "/postgres", autocommit=True) as c:
        c.execute(f'create database "{name}"')
    yield f"{pg_server}/{name}"
    with psycopg.connect(pg_server + "/postgres", autocommit=True) as c:
        c.execute(f'drop database if exists "{name}" with (force)')


@pytest.fixture
def pg_conn(pg_dsn):
    with psycopg.connect(pg_dsn, autocommit=True) as c:
        yield c


@pytest.fixture(scope="module")
def shop_db(pg_server):
    """Shop schema loaded with 1000 mock rows per table (module-scoped for speed)."""
    from app.ddl import parse_ddl
    from app.sandbox import rebuild_sandbox

    name = "shop_" + uuid.uuid4().hex[:8]
    with psycopg.connect(pg_server + "/postgres", autocommit=True) as c:
        c.execute(f'create database "{name}"')
    dsn = f"{pg_server}/{name}"
    ddl = (ROOT / "samples/shop.sql").read_text()
    graph = rebuild_sandbox(ddl, parse_ddl(ddl).graph, dsn=dsn)
    yield dsn, graph
    with psycopg.connect(pg_server + "/postgres", autocommit=True) as c:
        c.execute(f'drop database if exists "{name}" with (force)')
