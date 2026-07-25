import { maskSql } from './sqlAnalyzer';
export function redactSql(sql: string): string {
  return maskSql(sql)
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[UUID]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [TOKEN]')
    .replace(/\b(?:password|secret|token)\s*=\s*[^,\s;]+/gi, '$1=[REDACTED]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[HEX]');
}
