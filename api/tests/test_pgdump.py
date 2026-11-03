from pathlib import Path

import psycopg
import pytest

from app.ddl import DdlError, parse_ddl, strip_psql
from app.sandbox import rebuild_sandbox

DUMP = (Path(__file__).parent / "fixtures/pgdump18.sql").read_text()


def test_pg_dump_18_parses():
    r = parse_ddl(DUMP)
    assert [t.name for t in r.graph.tables] == ["public.Partner", "public.PartnerAddress"]
    assert [c.name for c in r.graph.tables[0].columns if c.pk] == ["partnerID"]
    assert [(f.from_.table, f.from_.columns, f.to.table) for f in r.graph.fks] == [("public.PartnerAddress", ["partnerID"], "public.Partner")]
    assert r.warnings == []  # SET / set_config / COMMENT / OWNER / GRANT / sequences are normal dump noise


def test_strip_psql_removes_meta_commands_and_copy_data_but_keeps_line_numbers():
    out = strip_psql(DUMP)
    assert "\\restrict" not in out and "\\unrestrict" not in out and "\\." not in out and "ACME" not in out
    assert out.count("\n") == DUMP.count("\n")


def test_syntax_error_line_numbers_still_match_the_original_file():
    bad = DUMP.replace("CREATE SEQUENCE public.address_seq", "CREATE SEQUENCEE public.address_seq")
    with pytest.raises(DdlError) as e:
        parse_ddl(bad)
    assert e.value.line == bad.splitlines().index("CREATE SEQUENCEE public.address_seq") + 1


def test_copy_without_data_terminator_does_not_swallow_the_schema():
    sql = "CREATE TABLE a(id int primary key);\nCOPY a (id) FROM stdin;\n1\n2\n"
    assert [t.name for t in parse_ddl(sql).graph.tables] == ["public.a"]


def test_sandbox_loads_the_rows_of_a_pg_dump_by_default(pg_dsn):
    out = rebuild_sandbox(DUMP, parse_ddl(DUMP).graph, rows_per_table=25, dsn=pg_dsn)
    assert [t.row_estimate for t in out.tables] == [1, 0]  # the file has one Partner row; its other table is empty
    with psycopg.connect(pg_dsn) as c:
        assert c.execute('select "fullName" from "Partner"').fetchone()[0] is not None
        assert c.execute("select nextval('public.address_seq')").fetchone()[0] >= 1  # sequence exists, owner statements skipped


def test_sandbox_can_ignore_the_rows_of_a_pg_dump(pg_dsn):
    from app.sandbox import rebuild_sandbox_report

    r = rebuild_sandbox_report(DUMP, parse_ddl(DUMP).graph, rows_per_table=25, use_dump_data=False, dsn=pg_dsn)
    assert [t.row_estimate for t in r.graph.tables] == [25, 25]
    with psycopg.connect(pg_dsn) as c:
        assert c.execute('select count(*) from "PartnerAddress" a join "Partner" p on p."partnerID" = a."partnerID"').fetchone()[0] == 25


def test_sandbox_skips_statements_that_fail_and_reports_them(pg_dsn):
    ddl = "create table a(id int primary key); create table b(id int primary key, a_id int references nope(id));"
    r = parse_ddl(ddl)
    out = rebuild_sandbox(ddl, r.graph, rows_per_table=5, dsn=pg_dsn)
    assert [t.name for t in out.tables] == ["public.a"]  # b could not be created, graph reflects what exists
