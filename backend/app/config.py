"""Application settings (12-factor: everything overridable via env vars)."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="PULSEPORT_", extra="ignore")

    app_name: str = "PulsePort Analytics"
    environment: str = "local"

    database_url: str = Field(
        default="postgresql+asyncpg://pulseport:pulseport@localhost:5432/pulseport",
        description="SQLAlchemy async URL",
    )
    db_pool_size: int = 10
    db_echo: bool = False

    seed_on_startup: bool = True
    seed_sessions: int = 50_000
    seed_ai_prompts: int = 300

    alpha: float = 0.05
    target_power: float = 0.80
    quote_sla_ms: int = 2500
    # Pre-registered minimum detectable effect (relative) used for the stop/continue rule
    mde_relative: float = 0.05
    # Max acceptable expected loss (absolute conversion points) to ship a variant
    expected_loss_threshold: float = 0.001

    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
