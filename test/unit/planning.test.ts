import { describe, expect, it } from 'vitest';
import { sanitizeFilename } from '../../src/planning/filenameSanitizer';
describe('filename safety', () => { it('makes a portable kebab case filename', () => expect(sanitizeFilename('../CON.sql', 80)).toBe('con-sql.sql')); });
