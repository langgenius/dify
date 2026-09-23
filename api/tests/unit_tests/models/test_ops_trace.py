import re

from sqlalchemy import Table
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from models.ops_trace import OpsTraceDelivery


def test_postgres_trace_delivery_ddl_declares_each_check_once() -> None:
    table = OpsTraceDelivery.__table__
    assert isinstance(table, Table)
    ddl = str(CreateTable(table).compile(dialect=postgresql.dialect()))

    # PostgreSQL rejects repeated constraint names even when their expressions
    # match. SQLite accepts them, so the usual SQLite fixtures cannot catch this.
    check_names = re.findall(r"\bCONSTRAINT (\w+) CHECK\b", ddl)
    assert sorted(check_names) == [
        "ops_trace_deliveries_ops_trace_delivery_destination_check",
        "ops_trace_deliveries_ops_trace_delivery_size_check",
        "ops_trace_deliveries_ops_trace_delivery_source_check",
    ]
