"""Connector request / response contracts (Pydantic v2, discriminated on ``type``)."""

from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PostgresSource(_Base):
    type: Literal["postgres"]
    host: str
    port: int = 5432
    database: str
    user: str
    password: SecretStr | None = None
    ssl: bool = False


class MySqlSource(_Base):
    type: Literal["mysql"]
    host: str
    port: int = 3306
    database: str
    user: str
    password: SecretStr | None = None
    ssl: bool = False


class SqliteSource(_Base):
    type: Literal["sqlite"]
    path: str = Field(description="File name inside PULSEPORT_SQLITE_DIR")


class CsvUrlSource(_Base):
    type: Literal["csv_url"]
    url: str

    @field_validator("url")
    @classmethod
    def _http(cls, v: str) -> str:
        if not re.match(r"^https?://", v.strip(), re.I):
            raise ValueError("only http(s) URLs are allowed")
        return v.strip()


GA4_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_:]{0,80}$")


class Ga4Source(_Base):
    type: Literal["ga4"]
    property_id: str = Field(description="Numeric GA4 property id, e.g. 123456789")
    start_date: str = "28daysAgo"
    end_date: str = "today"
    dimensions: list[str] = Field(default_factory=lambda: ["eventName"], min_length=1, max_length=9)
    metrics: list[str] = Field(default_factory=lambda: ["totalUsers"], min_length=1, max_length=10)
    event_names: list[str] = Field(default_factory=list, description="Optional filter on eventName")

    @field_validator("property_id")
    @classmethod
    def _pid(cls, v: str) -> str:
        v = v.strip().removeprefix("properties/")
        if not v.isdigit():
            raise ValueError("property_id must be the numeric GA4 property id")
        return v

    @field_validator("dimensions", "metrics")
    @classmethod
    def _names(cls, v: list[str]) -> list[str]:
        bad = [x for x in v if not GA4_NAME.match(x)]
        if bad:
            raise ValueError(f"invalid GA4 field name(s): {bad}")
        return v


SqlSource = PostgresSource | MySqlSource | SqliteSource
Source = Annotated[PostgresSource | MySqlSource | SqliteSource | CsvUrlSource | Ga4Source, Field(discriminator="type")]


class QueryRequest(_Base):
    connection: str | None = Field(None, description="Name of a saved connection (PULSEPORT_CONNECTIONS)")
    source: Source | None = Field(None, description="Ad-hoc connection details")
    query: str | None = Field(None, description="Read-only SQL (SQL sources only)")
    max_rows: int = Field(200_000, ge=1, le=2_000_000)


class TableOut(BaseModel):
    headers: list[str]
    rows: list[list[str]]
    row_count: int
    truncated: bool
    elapsed_ms: int
    source_label: str


class SavedConnection(BaseModel):
    name: str
    type: str
    label: str


class ConnectorsInfo(BaseModel):
    saved: list[SavedConnection]
    adhoc_allowed: bool
    ga4_configured: bool
    max_rows: int
    sqlite_dir: str | None
    types: list[str]
