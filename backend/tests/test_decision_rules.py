"""Go / No-Go decision rule tests (runs inside the API image)."""

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("sqlalchemy")

from app.services.experiments import decide  # noqa: E402
from app.stats_engine.bayesian import bayesian_ab_test  # noqa: E402
from app.stats_engine.frequentist import achieved_power, two_proportion_test  # noqa: E402


def _verdict(ca, na, cb, nb, days=None):
    f = two_proportion_test(ca, na, cb, nb).to_dict()
    b = bayesian_ab_test(ca, na, cb, nb, n_samples=50_000).to_dict()
    pw = achieved_power(ca / na, ca / na * 1.05, na, nb)
    return decide(f, b, days, pw)["verdict"]


def test_go_on_significant_positive_lift():
    assert _verdict(1200, 10_000, 1368, 10_000) == "GO"


def test_keep_running_when_underpowered():
    assert _verdict(3000, 10_000, 3087, 10_000, days=48) == "KEEP RUNNING"


def test_no_go_on_significant_negative():
    assert _verdict(1368, 10_000, 1200, 10_000) == "NO-GO"


def test_stop_when_powered_and_null():
    # 100k per arm gives >99 % power for a +5 % relative MDE at 30 % baseline
    assert _verdict(30_000, 100_000, 30_010, 100_000) == "STOP"
