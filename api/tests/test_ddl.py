import json
from pathlib import Path

import pytest

from app.ddl import DdlError, parse_ddl

ROOT = Path(__file__).resolve().parents[2]


def fk(res, frm):
    return [f for f in res.graph.fks if f.from_.table == frm]


def test_composite_fk():
    r = parse_ddl("create table p(a int, b int, primary key(a,b)); create table c(x int, y int, foreign key (x,y) references p(a,b));")
    f = r.graph.fks[0]
    assert f.from_.columns == ["x", "y"] and f.to.columns == ["a", "b"]


def test_self_reference_fk():
    r = parse_ddl("create table employees(id int primary key, manager_id int references employees(id));")
    assert r.graph.fks[0].from_.table == r.graph.fks[0].to.table == "public.employees"


def test_cyclic_fks():
    r = parse_ddl("create table a(id int primary key, b_id int); create table b(id int primary key, a_id int references a(id)); alter table a add foreign key (b_id) references b(id);")
    assert {(f.from_.table, f.to.table) for f in r.graph.fks} == {("public.a", "public.b"), ("public.b", "public.a")}


def test_alter_table_add_fk():
    r = parse_ddl("create table a(id int primary key); create table b(a_id int); alter table b add constraint fk_b_a foreign key (a_id) references a(id);")
    assert r.graph.fks[0].id == "fk_b_a"


def test_unsupported_skipped():
    r = parse_ddl("create table t(id int); create function f() returns int language sql as 'select 1'; create trigger g before insert on t for each row execute function f();")
    assert r.warnings and len(r.graph.tables) == 1


def test_syntax_error_position():
    with pytest.raises(DdlError) as e:
        parse_ddl("create table a(id int);\ncreate tabel b(id int);")
    assert e.value.line == 2


@pytest.mark.parametrize("sql", ["", "-- only comment"])
def test_zero_tables_rejected(sql):
    with pytest.raises(DdlError, match="no tables found"):
        parse_ddl(sql)


def test_quoted_names():
    r = parse_ddl('create table "Order Items"(id int); create table "a""b"(id int);')
    assert [t.name for t in r.graph.tables] == ["public.Order Items", 'public.a"b']


def test_same_name_two_schemas():
    r = parse_ddl("create schema audit; create table public.users(id int); create table audit.users(id int);")
    assert {t.name for t in r.graph.tables} == {"public.users", "audit.users"}


def test_shop_matches_fixture():
    r = parse_ddl((ROOT / "samples/shop.sql").read_text())
    assert len(r.graph.tables) == 25 and r.warnings == []
    expected = json.loads((ROOT / "samples/shop.graph.json").read_text())
    assert r.graph.model_dump(by_alias=True) == expected


def test_api_default_and_error():
    from fastapi.testclient import TestClient

    from app.main import app

    c = TestClient(app)
    assert len(c.get("/api/schema/default").json()["graph"]["tables"]) == 25
    r = c.post("/api/schema", json={"ddl": "create tabel x(id int);"})
    assert r.status_code == 422 and r.json()["line"] == 1
