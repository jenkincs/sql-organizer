import { describe, expect, it } from 'vitest';
import { detectDialect, detectOperation, extractParameters, extractTables, normalizeSql } from '../../src/scanner/sqlAnalyzer';
import { redactSql } from '../../src/scanner/sqlRedactor';

describe('SQL analysis', () => {
  it('does not interpret comment or string keywords as operations', () => { expect(detectOperation("-- DELETE\nWITH c AS (SELECT 1) SELECT 'UPDATE' FROM users")).toBe('SELECT'); });
  it('extracts tables and parameters outside literal text', () => { const sql = "SELECT * FROM app.users u JOIN roles r ON r.id=u.role_id WHERE u.id=:id AND x=${value}"; expect(extractTables(sql)).toEqual(['app.users', 'roles']); expect(extractParameters(sql)).toEqual([':id', '${value}']); });
  it('normalizes literals and comments', () => { expect(normalizeSql("SELECT 'a' -- 99\n FROM users WHERE id=42;")).toBe('SELECT ? FROM USERS WHERE ID=?'); });
  it('detects dialect hints only as a hint', () => { expect(detectDialect('SELECT NVL(name, \'\') FROM dual')).toBe('oracle'); });
  it('redacts known sensitive forms', () => { const redacted = redactSql("select 'joe@example.com', '10.2.3.4', token=abc"); expect(redacted).not.toContain('joe@example.com'); expect(redacted).not.toContain('10.2.3.4'); });
});
