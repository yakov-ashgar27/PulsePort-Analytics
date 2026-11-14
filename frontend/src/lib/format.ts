const nf = new Intl.NumberFormat("en-US");

export const fmtInt = (n: number | null | undefined) => (n == null ? "—" : nf.format(Math.round(n)));

export const fmtPct = (x: number | null | undefined, digits = 1, signed = false) => {
  if (x == null || !Number.isFinite(x)) return "—";
  const s = `${(x * 100).toFixed(digits)}%`;
  return signed && x > 0 ? `+${s}` : s;
};

/** For values already expressed in 0–100. */
export const fmtPct100 = (x: number | null | undefined, digits = 1) =>
  x == null ? "—" : `${Number(x).toFixed(digits)}%`;

export const fmtP = (p: number | null | undefined) => {
  if (p == null) return "—";
  if (p < 0.0001) return "< 0.0001";
  if (p < 0.01) return p.toFixed(4);
  return p.toFixed(3);
};

export const fmtProb = (p: number) => (p > 0.999 ? "> 99.9%" : p < 0.001 ? "< 0.1%" : fmtPct(p, 1));

export const fmtMs = (ms: number | null | undefined) =>
  ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;

export const fmtUsd = (x: number | null | undefined, digits = 2) => (x == null ? "—" : `$${x.toFixed(digits)}`);

export const stageLabel = (s: string) =>
  s
    .toLowerCase()
    .split("_")
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
