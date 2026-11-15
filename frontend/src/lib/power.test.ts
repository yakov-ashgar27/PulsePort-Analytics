// Run: node --experimental-strip-types --test src/lib/power.test.ts
// Fixtures come from the real Python API (exported in CI) or, locally, the engine.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { normPpf, powerAnalysis, type PowerOutput } from "./power.ts";

const fixturePath = process.env.POWER_FIXTURES ?? new URL("../../public/data/power-fixtures.json", import.meta.url).pathname;

test("normPpf matches known quantiles", () => {
  assert.ok(Math.abs(normPpf(0.975) - 1.959963984540054) < 1e-8);
  assert.ok(Math.abs(normPpf(0.8) - 0.8416212335729143) < 1e-8);
  assert.ok(Math.abs(normPpf(0.005) + 2.5758293035489) < 1e-8);
  assert.throws(() => normPpf(1));
});

test("textbook sample size: 10% → 12% needs 3,841 per arm", () => {
  const r = powerAnalysis({ baseline_rate: 0.1, mde_relative: 0.2, alpha: 0.05, power: 0.8, daily_traffic: 1000 });
  assert.equal(r.sample_size_per_variant, 3841);
});

test("parity with the Python engine on exported fixtures", () => {
  let fixtures: PowerOutput[];
  try {
    fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));
  } catch {
    console.warn(`no fixtures at ${fixturePath} — skipping parity test`);
    return;
  }
  assert.ok(fixtures.length >= 10);
  for (const f of fixtures) {
    const r = powerAnalysis(f);
    assert.equal(r.sample_size_per_variant, f.sample_size_per_variant, JSON.stringify(f));
    assert.equal(r.estimated_days, f.estimated_days);
    assert.ok(Math.abs(r.cohens_h - f.cohens_h) < 1e-12);
  }
});
