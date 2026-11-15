"""
Defence-in-depth for user-supplied SQL.

The *real* guarantee is that every query runs inside a READ ONLY transaction
with a statement timeout (see sql.py). This module adds a cheap static check so
obviously unsafe input is rejected with a clear message before any connection
is opened.
"""

from __future__ import annotations

import re
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any

_LINE_COMMENT = re.compile(r"--[^\n]*")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
_STRING = re.compile(r"'(?:[^']|'')*'")
_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|exec|execute|"
    r"vacuum|analyze|attach|detach|pragma|load_file|outfile|dumpfile|lock|unlock|set|begin|commit|rollback)\b",
    re.I,
)


class UnsafeQuery(ValueError):
    pass


def check_read_only_sql(sql: str) -> str:
    """Return the normalised statement, or raise UnsafeQuery."""
    if not sql or not sql.strip():
        raise UnsafeQuery("Query is empty.")
    stripped = _BLOCK_COMMENT.sub(" ", _LINE_COMMENT.sub(" ", sql)).strip()
    stripped = stripped.rstrip(";").strip()
    without_strings = _STRING.sub("''", stripped)
    if ";" in without_strings:
        raise UnsafeQuery("Only a single statement is allowed.")
    first = re.match(r"^\(*\s*(\w+)", without_strings)
    if not first or first.group(1).lower() not in {"select", "with", "values", "table"}:
        raise UnsafeQuery("Only read-only queries are allowed (SELECT / WITH).")
    m = _FORBIDDEN.search(without_strings)
    if m:
        raise UnsafeQuery(f"Keyword '{m.group(1).upper()}' is not allowed in a read-only query.")
    return stripped


def cell(v: Any) -> str:
    """Render a DB value as the plain string the Data Studio parser expects."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, datetime):
        return v.isoformat(sep=" ", timespec="seconds")
    if isinstance(v, date | time):
        return v.isoformat()
    if isinstance(v, Decimal):
        return format(v, "f")
    if isinstance(v, float):
        return repr(v)
    if isinstance(v, bytes | bytearray | memoryview):
        return bytes(v).hex()
    return str(v)
