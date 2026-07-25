import { createHash } from 'crypto';
import { SqlDialect, SqlOperation } from '../domain/models';

/** Masks comments and literals while retaining offsets; this deliberately does not claim full dialect parsing. */
export function maskSql(sql: string): string {
  let output = '';
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      output += ' '.repeat((end < 0 ? sql.length : end) - i);
      i = end < 0 ? sql.length : end;
    } else if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      const stop = end < 0 ? sql.length : end + 2;
      output += ' '.repeat(stop - i);
      i = stop;
    } else if (sql[i] === "'") {
      let end = i + 1;
      while (end < sql.length) {
        if (sql[end] === "'" && sql[end + 1] === "'") {
          end += 2;
          continue;
        }
        if (sql[end++] === "'") break;
      }
      output += "'" + ' '.repeat(Math.max(0, end - i - 2)) + "'";
      i = end;
    } else {
      output += sql[i++];
    }
  }
  return output;
}
export function normalizeSql(sql: string): string {
  return maskSql(sql)
    .replace(/'(?:[^']|'')*'/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/[;,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}
export function normalizedTokenSignature(sql: string): string[] {
  return (
    normalizeSql(sql)
      .match(/[A-Z_][A-Z0-9_$]*|\?|[()=<>]+/g)
      ?.slice(0, 512) ?? []
  );
}
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function detectOperation(sql: string): SqlOperation {
  const text = maskSql(sql)
    .replace(/^\s*(?:WITH\s+(?:RECURSIVE\s+)?[\s\S]*?\)\s*)+/i, '')
    .trim()
    .toUpperCase();
  if (/^(SELECT|VALUES|EXPLAIN)\b/.test(text)) return 'SELECT';
  if (/^INSERT\b/.test(text)) return 'INSERT';
  if (/^UPDATE\b/.test(text)) return 'UPDATE';
  if (/^DELETE\b/.test(text)) return 'DELETE';
  if (/^MERGE\b/.test(text)) return 'MERGE';
  if (/^(CREATE|ALTER|DROP|TRUNCATE|COMMENT|GRANT|REVOKE)\b/.test(text)) return 'DDL';
  if (/^(DECLARE|BEGIN|PROCEDURE|FUNCTION|PACKAGE|TRIGGER)\b/.test(text)) return 'PLSQL';
  return 'UNKNOWN';
}
export function detectDialect(sql: string): SqlDialect {
  const u = maskSql(sql).toUpperCase();
  const checks: [SqlDialect, RegExp][] = [
    ['oracle', /\b(ROWNUM|NVL|SYSDATE|CONNECT\s+BY|DUAL|DECODE|LISTAGG)\b/],
    ['postgresql', /\b(ILIKE|RETURNING|JSONB|GENERATE_SERIES)\b|::/],
    ['mysql', /`|\b(IFNULL|LIMIT|ON\s+DUPLICATE\s+KEY)\b/],
    ['sqlserver', /\b(TOP|GETDATE|NOLOCK|GO)\b|\[[^\]]+\]/],
    ['sqlite', /\b(SQLITE_MASTER|WITHOUT\s+ROWID|PRAGMA)\b/],
  ];
  return checks.find(([, regex]) => regex.test(u))?.[0] ?? 'generic';
}
export function extractTables(sql: string): string[] {
  const masked = maskSql(sql);
  const found = new Set<string>();
  const regex =
    /\b(?:FROM|JOIN|UPDATE|INSERT\s+INTO|MERGE\s+INTO|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|TRUNCATE\s+TABLE)\s+([\w.$"`\[\]-]+)/gi;
  for (const match of masked.matchAll(regex)) {
    const table = match[1].replace(/["`\[\]]/g, '');
    if (!/^\s*\(/.test(table)) found.add(table);
  }
  return [...found];
}
export function extractParameters(sql: string): string[] {
  return [...new Set(sql.match(/(?::[A-Za-z_]\w*|\$\{[A-Za-z_]\w*\}|@[A-Za-z_]\w*|\?)/g) ?? [])];
}
