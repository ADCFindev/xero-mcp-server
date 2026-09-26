export function formatXeroDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? String(value) : value.toISOString();
  }

  if (typeof value === "string") {
    const xeroMatch = value.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);
    if (xeroMatch) {
      const ms = Number(xeroMatch[1]);
      if (ms === -62135596800000) return null;
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? value : date.toISOString();
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime()) && /\d{4}-\d{2}-\d{2}/.test(value)) {
      return parsed.toISOString();
    }
  }

  return String(value);
}

export function formatAmount(value: number | null | undefined): string {
  return (value ?? 0).toFixed(2);
}

export function normalizeXeroOutput(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (value instanceof Date) {
    return formatXeroDate(value);
  }

  if (typeof value === "string") {
    if (/^\/Date\(/.test(value)) {
      return formatXeroDate(value);
    }
    return value.replace(/\r\n/g, "\n");
  }

  if (Array.isArray(value)) {
    return value.map(normalizeXeroOutput);
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const normalized = normalizeXeroOutput(item);
      if (normalized !== undefined && normalized !== null) {
        result[key] = normalized;
      }
    }
    return result;
  }

  return value;
}
