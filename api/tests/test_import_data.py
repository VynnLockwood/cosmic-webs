"""Importing a pg_dump / pgAdmin export that contains real rows, and robust mock data for the rest."""
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.ddl import extract_copy_blocks, parse_ddl
from app.main import app
from app.sandbox import rebuild_sandbox_report
from app.sources import registry

T = "\t"
SCHEMA = """
CREATE TABLE public."mtFuel" ("mtFuelID" character varying(20) NOT NULL, label character varying(50));
CREATE TABLE public."mtZone" ("zoneID" uuid NOT NULL, name text);
CREATE TABLE public."sppProject" (
    "sppProjectID" uuid NOT NULL, name character varying(100), "mtFuel" character varying(20), "mtZone" uuid,
    "Jukkee1" aclitem, tags text[], price numeric(10,2), flag boolean);
CREATE TABLE public."sppAddress" ("addressID" uuid NOT NULL, "sppProject" uuid, city text);
CREATE TABLE public."sppCase" ("caseID" uuid NOT NULL, "sppProject" uuid);
ALTER TABLE ONLY public."mtFuel" ADD CONSTRAINT "mtFuel_pkey" PRIMARY KEY ("mtFuelID");
ALTER TABLE ONLY public."mtZone" ADD CONSTRAINT "mtZone_pkey" PRIMARY KEY ("zoneID");
ALTER TABLE ONLY public."sppProject" ADD CONSTRAINT "sppProject_pkey" PRIMARY KEY ("sppProjectID");
ALTER TABLE ONLY public."sppAddress" ADD CONSTRAINT "sppAddress_pkey" PRIMARY KEY ("addressID");
ALTER TABLE ONLY public."sppCase" ADD CONSTRAINT "sppCase_pkey" PRIMARY KEY ("caseID");
ALTER TABLE ONLY public."sppProject" ADD CONSTRAINT "sppProject_fuel_fkey" FOREIGN KEY ("mtFuel") REFERENCES public."mtFuel"("mtFuelID");
ALTER TABLE ONLY public."sppProject" ADD CONSTRAINT "sppProject_zone_fkey" FOREIGN KEY ("mtZone") REFERENCES public."mtZone"("zoneID");
"""
P1, P2, P3 = "11111111-0000-0000-0000-000000000001", "11111111-0000-0000-0000-000000000002", "11111111-0000-0000-0000-000000000003"
Z1, Z2 = "22222222-0000-0000-0000-000000000001", "22222222-0000-0000-0000-000000000002"
DATA = (
    'COPY public."mtFuel" ("mtFuelID", label) FROM stdin;\n' + f"benefit{T}Benefit\ncoal{T}Coal\ngas{T}Gas\\tPlant\n" + "\\.\n\n"
    + 'COPY public."mtZone" ("zoneID", name) FROM stdin;\n' + f"{Z1}{T}North\n{Z2}{T}South\n" + "\\.\n\n"
    + 'COPY public."sppProject" ("sppProjectID", name, "mtFuel", "mtZone", "Jukkee1", tags, price, flag) FROM stdin;\n'
    + f"{P1}{T}Solar A{T}benefit{T}{Z1}{T}\\N{T}{{a,b}}{T}12.50{T}t\n{P2}{T}Wind B{T}coal{T}{Z2}{T}\\N{T}\\N{T}\\N{T}f\n{P3}{T}Hydro C{T}gas{T}\\N{T}\\N{T}{{}}{T}1.00{T}t\n" + "\\.\n\n"
    + 'COPY public."sppAddress" ("addressID", "sppProject", city) FROM stdin;\n'
    + f"aaaaaaaa-0000-0000-0000-000000000001{T}{P1}{T}Bangkok\naaaaaaaa-0000-0000-0000-000000000002{T}{P1}{T}Chiang Mai\naaaaaaaa-0000-0000-0000-000000000003{T}{P2}{T}Phuket\n" + "\\.\n\n"
    + 'COPY public."sppCase" ("caseID", "sppProject") FROM stdin;\n\\.\n'
)
DUMP = "\\restrict abc\n" + SCHEMA + DATA + "\\unrestrict abc\n"


def q(conn, sql):
    return conn.execute(sql).fetchall()


def test_extract_copy_blocks_reads_table_columns_and_raw_rows():
    blocks = extract_copy_blocks(DUMP)
    assert [b.table for b in blocks] == ["public.mtFuel", "public.mtZone", "public.sppProject", "public.sppAddress", "public.sppCase"]
    assert blocks[0].columns == ["mtFuelID", "label"]
    assert blocks[0].rows == 3 and blocks[0].data.splitlines()[0] == f"benefit{T}Benefit"
    assert blocks[4].rows == 0
    assert extract_copy_blocks(SCHEMA) == []


def test_real_rows_are_loaded_and_empty_tables_stay_empty(pg_dsn):
    r = rebuild_sandbox_report(DUMP, parse_ddl(DUMP).graph, rows_per_table=500, dsn=pg_dsn)
    counts = {t.name.split(".")[1]: t.row_estimate for t in r.graph.tables}
    assert counts == {"mtFuel": 3, "mtZone": 2, "sppProject": 3, "sppAddress": 3, "sppCase": 0}
    assert (r.data_source, r.rows_loaded, r.tables_with_data) == ("dump", 11, 4)
    with psycopg.connect(pg_dsn) as c:
        assert q(c, 'select "mtFuelID", label from "mtFuel" order by 1') == [("benefit", "Benefit"), ("coal", "Coal"), ("gas", "Gas\tPlant")]  # COPY escapes are honoured
        assert q(c, 'select count(*) from "sppProject" where "mtZone" is null')[0][0] == 1  # \N became NULL
        assert q(c, "select tags from \"sppProject\" where name = 'Solar A'")[0][0] == ["a", "b"]


def test_declared_foreign_keys_hold_for_the_loaded_data(pg_dsn):
    r = rebuild_sandbox_report(DUMP, parse_ddl(DUMP).graph, dsn=pg_dsn)
    with psycopg.connect(pg_dsn) as c:
        assert q(c, 'select count(*) from "sppProject" p where p."mtFuel" is not null and not exists (select 1 from "mtFuel" f where f."mtFuelID" = p."mtFuel")')[0][0] == 0
    assert r.warnings == []


def test_the_read_only_role_can_query_the_imported_tables(pg_dsn, monkeypatch):
    monkeypatch.setenv("SANDBOX_DSN", pg_dsn)
    rebuild_sandbox_report(DUMP, parse_ddl(DUMP).graph, dsn=pg_dsn)
    registry.use_sandbox()
    with registry.session() as s:
        assert s.execute('select count(*) from "sppProject"').fetchone()[0] == 3


def test_use_dump_data_false_generates_mock_rows_instead(pg_dsn):
    r = rebuild_sandbox_report(DUMP, parse_ddl(DUMP).graph, rows_per_table=40, use_dump_data=False, dsn=pg_dsn)
    assert r.data_source == "mock" and all(t.row_estimate == 40 for t in r.graph.tables)


def test_schema_only_dump_gets_mock_rows_with_unique_text_keys(pg_dsn):
    """Text primary keys must be unique, arrays and types we cannot fake (aclitem) must not break the load."""
    r = rebuild_sandbox_report(SCHEMA, parse_ddl(SCHEMA).graph, rows_per_table=3000, dsn=pg_dsn)
    assert r.warnings == [], r.warnings
    assert r.data_source == "mock"
    with psycopg.connect(pg_dsn) as c:
        assert q(c, 'select count(distinct "mtFuelID") from "mtFuel"')[0][0] == 3000  # varchar(20) primary key
        assert q(c, 'select count(*) from "sppProject" where "Jukkee1" is not null')[0][0] == 0


def test_one_bad_data_block_is_reported_and_the_rest_still_loads(pg_dsn, monkeypatch):
    bad = DUMP.replace(f"aaaaaaaa-0000-0000-0000-000000000002{T}{P1}", f"not-a-uuid{T}{P1}")
    monkeypatch.setenv("SANDBOX_DSN", pg_dsn)
    r = rebuild_sandbox_report(bad, parse_ddl(bad).graph, dsn=pg_dsn)
    assert any("sppAddress" in w and "not loaded" in w for w in r.warnings), r.warnings
    counts = {t.name.split(".")[1]: t.row_estimate for t in r.graph.tables}
    assert counts["sppProject"] == 3 and counts["mtFuel"] == 3 and counts["sppAddress"] == 0
    registry.use_sandbox()
    with registry.session() as s:  # grants were applied even though a table failed
        assert s.execute('select count(*) from "sppProject"').fetchone()[0] == 3


def test_post_schema_reports_what_was_loaded(pg_dsn, monkeypatch):
    monkeypatch.setenv("SANDBOX_DSN", pg_dsn)
    r = TestClient(app).post("/api/schema", json={"ddl": DUMP}).json()
    assert r["data"] == {"source": "dump", "rows_loaded": 11, "tables_with_data": 4, "tables_empty": 1}
    assert registry.graph and len(registry.graph.tables) == 5


def test_a_failing_data_fill_never_leaves_the_sandbox_unusable(pg_dsn, monkeypatch):
    """The reported symptoms: 'permission denied' on search and 'unknown table' in the panel after a failed fill."""
    import app.sandbox as sb

    def boom(*a, **k):
        raise psycopg.errors.UniqueViolation("duplicate key value violates unique constraint")

    monkeypatch.setattr(sb, "fill_mock", boom)
    monkeypatch.setenv("SANDBOX_DSN", pg_dsn)
    c = TestClient(app)
    r = c.post("/api/schema", json={"ddl": SCHEMA}).json()
    assert any("duplicate key" in w for w in r["warnings"])
    assert len(r["graph"]["tables"]) == 5
    assert c.get("/api/tables/public.sppProject/rows").status_code == 200  # known table, readable by the reader role
