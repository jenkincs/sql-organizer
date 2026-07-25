const reserved = new Set(['con', 'prn', 'aux', 'nul', 'com1', 'lpt1']);
export function sanitizeFilename(value: string, maxLength: number): string { const base = value.toLowerCase().replace(/\.sql$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, Math.max(1, maxLength - 4)) || 'unnamed'; return `${reserved.has(base) ? `${base}-sql` : base}.sql`; }
