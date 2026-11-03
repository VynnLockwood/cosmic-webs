"""The SQL the web app shows for copy-paste (cross-joined 'before' query, hardcoded values) is valid Postgres."""
import psycopg


def run(dsn, sql):
    with psycopg.connect(dsn, autocommit=True) as c:
        cur = c.execute(sql)
        return cur.fetchall() if cur.description else []


def test_before_query_with_cross_join_runs(shop_db):
    dsn, _ = shop_db
    sql = (
        'SELECT "users"."email", "addresses"."line1"\n'
        'FROM "public"."users", "public"."addresses"\n'
        "-- no foreign-key path between these tables, so they are cross-joined: every row pairs with every row\n"
        "WHERE \"users\".\"id\" = 1 AND (\"addresses\".\"city\" IS NULL OR \"addresses\".\"id\" IN (1, 2))\n"
        "LIMIT 5"
    )
    assert run(dsn, sql) is not None


def test_hardcoded_values_with_quotes_and_thai_text_run(shop_db):
    dsn, _ = shop_db
    sql = "SELECT \"t0\".\"email\" FROM \"public\".\"users\" AS \"t0\" WHERE \"t0\".\"name\" = 'BigLot 2565 (รอบเพิ่มเติม)' OR \"t0\".\"name\" = 'it''s' AND \"t0\".\"is_active\" = TRUE AND \"t0\".\"id\" BETWEEN 1 AND 5"
    assert run(dsn, sql) == []
