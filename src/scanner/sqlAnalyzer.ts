import { createHash } from 'crypto';
import { SqlDialect, SqlOperation } from '../domain/models';

export interface SqlStatementFragment {
  sql: string;
  index: number;
  startLine: number;
  endLine: number;
  safety: 'safe' | 'keep-together' | 'ambiguous';
}

const proceduralOrTransactional =
  /^\s*(?:DECLARE|BEGIN\b|CREATE\s+(?:OR\s+REPLACE\s+)?(?:PROCEDURE|FUNCTION|PACKAGE|TRIGGER)\b|START\s+TRANSACTION\b|COMMIT\b|ROLLBACK\b|SAVEPOINT\b)/i;

/** Splits simple top-level SQL only; uncertain, transactional, or procedural files stay intact. */
export function splitSqlStatements(sql: string, maxStatements = 200): SqlStatementFragment[] {
  const single = (safety: SqlStatementFragment['safety']): SqlStatementFragment[] => [
    { sql, index: 0, startLine: 1, endLine: sql.split('\n').length, safety },
  ];
  if (!sql.trim() || proceduralOrTransactional.test(maskSql(sql))) return single('keep-together');
  const boundaries: { end: number; line: number }[] = [];
  let state: 'plain' | 'single' | 'double' | 'backtick' | 'bracket' | 'line-comment' | 'block-comment' | 'dollar' =
    'plain';
  let dollarTag = '';
  let line = 1;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === '\n') line += 1;
    if (state === 'line-comment') {
      if (char === '\n') state = 'plain';
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'plain';
        index += 1;
      }
      continue;
    }
    if (state === 'single') {
      if (char === "'" && next === "'") index += 1;
      else if (char === "'") state = 'plain';
      continue;
    }
    if (state === 'double') {
      if (char === '"') state = 'plain';
      continue;
    }
    if (state === 'backtick') {
      if (char === '`') state = 'plain';
      continue;
    }
    if (state === 'bracket') {
      if (char === ']') state = 'plain';
      continue;
    }
    if (state === 'dollar') {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        state = 'plain';
      }
      continue;
    }
    if (char === '-' && next === '-') {
      state = 'line-comment';
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block-comment';
      index += 1;
      continue;
    }
    if (char === "'") {
      state = 'single';
      continue;
    }
    if (char === '"') {
      state = 'double';
      continue;
    }
    if (char === '`') {
      state = 'backtick';
      continue;
    }
    if (char === '[') {
      state = 'bracket';
      continue;
    }
    if (char === '$') {
      const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarTag = match[0];
        state = 'dollar';
        index += dollarTag.length - 1;
        continue;
      }
    }
    if (char === ';') boundaries.push({ end: index + 1, line });
  }
  if (state !== 'plain' || boundaries.length >= maxStatements) return single('ambiguous');
  const fragments: SqlStatementFragment[] = [];
  let start = 0;
  let startLine = 1;
  for (const boundary of boundaries) {
    const fragment = sql.slice(start, boundary.end);
    if (maskSql(fragment).trim())
      fragments.push({ sql: fragment, index: fragments.length, startLine, endLine: boundary.line, safety: 'safe' });
    start = boundary.end;
    startLine = boundary.line;
  }
  const tail = sql.slice(start);
  if (maskSql(tail).trim())
    fragments.push({ sql: tail, index: fragments.length, startLine, endLine: sql.split('\n').length, safety: 'safe' });
  return fragments.length > 1 ? fragments : single('keep-together');
}

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
