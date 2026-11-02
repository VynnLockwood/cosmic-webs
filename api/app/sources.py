"""Active data source: the built-in sandbox or an optional live Postgres (read-only)."""
import os
from contextlib import contextmanager
from typing import Literal

import psycopg
from pydantic import BaseModel, ConfigDict, Field

from .models import SchemaGraph

LIVE_TIMEOUT = "5s"


class LiveParams(BaseModel):
    host: str
    port: int = 5432
    dbname: str
    user: str
    password: str = ""
    schema_: str = Field("public", alias="schema")
    allow_analyze: bool = False

    model_config = ConfigDict(populate_by_name=True)


class SourceRegistry:
    """Credentials live in this object's memory only."""

    def __init__(self) -> None:
        self.mode: Literal["sandbox", "live"] = "sandbox"
        self.live: LiveParams | None = None
        self.graph: SchemaGraph | None = None

    def use_sandbox(self) -> None:
        self.mode, self.live = "sandbox", None

    def use_live(self, p: LiveParams) -> None:
        with self._connect_live(p):  # fail early, keep previous mode on error
            pass
        self.mode, self.live = "live", p

    @staticmethod
    def _connect_live(p: LiveParams) -> psycopg.Connection:
        conn = psycopg.connect(host=p.host, port=p.port, dbname=p.dbname, user=p.user, password=p.password, connect_timeout=5, autocommit=True)
        conn.execute("SET default_transaction_read_only = on")
        conn.execute(f"SET statement_timeout = '{LIVE_TIMEOUT}'")
        return conn

    @contextmanager
    def session(self):
        if self.mode == "live" and self.live:
            conn = self._connect_live(self.live)
        else:
            conn = psycopg.connect(os.environ["SANDBOX_DSN"], autocommit=True)
        try:
            yield conn
        finally:
            conn.close()

    @property
    def schema(self) -> str:
        return self.live.schema_ if self.mode == "live" and self.live else "public"

    def active_graph(self) -> SchemaGraph:
        if self.graph is None:
            from .introspect import introspect

            with self.session() as c:
                self.graph = introspect(c, self.schema)
        return self.graph


registry = SourceRegistry()
