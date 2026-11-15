/**
 * RFC 4180 CSV parser with delimiter sniffing (comma, semicolon, tab, pipe),
 * quoted fields, escaped quotes, CRLF/LF and UTF-8 BOM handling.
 */

export interface Table {
  headers: string[];
  rows: string[][];
  delimiter: string;
  skipped: number; // rows with a different column count
}

const DELIMS = [",", ";", "\t", "|"];

function sniff(sample: string): string {
  const lines = sample.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ",";
  let bestScore = -1;
  for (const d of DELIMS) {
    const counts = lines.map((l) => splitLine(l, d).length);
    if (counts[0]! < 2) continue;
    const consistent = counts.filter((c) => c === counts[0]).length;
    const score = consistent * 100 + counts[0]!;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function splitLine(line: string, d: string): string[] {
  return parseRows(line, d)[0] ?? [];
}

function parseRows(text: string, d: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === "") inQuotes = true;
    else if (ch === d) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseCsv(input: string): Table {
  const text = input.replace(/^﻿/, "");
  const delimiter = sniff(text.slice(0, 20_000));
  const all = parseRows(text, delimiter).filter((r) => !(r.length === 1 && r[0]!.trim() === ""));
  if (all.length < 2) throw new Error("The file needs a header row and at least one data row.");
  const headers = all[0]!.map((h, i) => h.trim() || `column_${i + 1}`);
  // De-duplicate header names
  const seen = new Map<string, number>();
  const unique = headers.map((h) => {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h}_${n}`;
  });
  const rows: string[][] = [];
  let skipped = 0;
  for (const r of all.slice(1)) {
    if (r.length === unique.length) rows.push(r.map((v) => v.trim()));
    else if (r.length > unique.length && r.slice(unique.length).every((v) => v.trim() === "")) rows.push(r.slice(0, unique.length).map((v) => v.trim()));
    else skipped++;
  }
  return { headers: unique, rows, delimiter, skipped };
}

/** Turn a Google Sheets share/edit link into a CORS-friendly CSV export URL. */
export function normalizeSourceUrl(url: string): string {
  const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) return url.trim();
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv&gid=${gid}`;
}

export function toCsv(headers: string[], rows: (string | number | boolean | null)[][]): string {
  const esc = (v: string | number | boolean | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}
