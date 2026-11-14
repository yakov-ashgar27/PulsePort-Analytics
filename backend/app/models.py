"""ORM models. Indexes are designed around the analytical query patterns."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    Index,
    Integer,
    Numeric,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base

STAGES = ("PORTAL_VISIT", "ROUTE_SEARCH", "RATE_QUOTE", "BOOKING_CONFIRMED")


class SessionEvent(Base):
    """One row per funnel event in a customer-portal session."""

    __tablename__ = "session_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(36), nullable=False)
    event_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    stage: Mapped[str] = mapped_column(String(32), nullable=False)
    region: Mapped[str] = mapped_column(String(48), nullable=False)
    device_type: Mapped[str] = mapped_column(String(16), nullable=False)
    # Rate-quote API latency experienced after ROUTE_SEARCH (NULL on other stages)
    quote_latency_ms: Mapped[int | None] = mapped_column(Integer)

    __table_args__ = (
        CheckConstraint(f"stage IN {STAGES}", name="ck_stage"),
        CheckConstraint("device_type IN ('Desktop', 'Mobile')", name="ck_device"),
        Index("ix_events_stage_region_device", "stage", "region", "device_type"),
        Index("ix_events_ts", "event_ts"),
        Index("ix_events_session", "session_id"),
    )


class ExperimentAssignment(Base):
    """Randomised assignment of a session to an experiment arm + outcome."""

    __tablename__ = "experiment_assignments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    experiment_id: Mapped[str] = mapped_column(String(16), nullable=False)
    session_id: Mapped[str] = mapped_column(String(36), nullable=False)
    variant: Mapped[str] = mapped_column(String(1), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    converted: Mapped[bool] = mapped_column(Boolean, nullable=False)
    time_to_quote_s: Mapped[float] = mapped_column(Float, nullable=False)

    __table_args__ = (
        CheckConstraint("variant IN ('A', 'B')", name="ck_variant"),
        Index("ix_assign_exp_variant", "experiment_id", "variant"),
    )


class AiEvalRun(Base):
    """A single graded answer of one AI model to one maritime support prompt."""

    __tablename__ = "ai_eval_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    batch_id: Mapped[str] = mapped_column(String(40), nullable=False)
    prompt_id: Mapped[str] = mapped_column(String(16), nullable=False)
    category: Mapped[str] = mapped_column(String(48), nullable=False)
    model: Mapped[str] = mapped_column(String(48), nullable=False)
    accuracy_score: Mapped[float] = mapped_column(Float, nullable=False)
    hallucination: Mapped[bool] = mapped_column(Boolean, nullable=False)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    cost_usd: Mapped[float] = mapped_column(Numeric(12, 6, asdecimal=False), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint("accuracy_score BETWEEN 0 AND 100", name="ck_accuracy"),
        Index("ix_ai_model_category", "model", "category"),
    )
