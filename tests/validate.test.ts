import { describe, expect, it } from 'vitest';
import { validateData } from '../apps/api/src/validate';

const schema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string' }, total: { type: 'number', minimum: 0 } },
  additionalProperties: false,
};

describe('schema validation (ajv)', () => {
  it('passes conforming data', () => {
    expect(validateData(schema, { id: 'SYN-1', total: 42 })).toEqual({ valid: true, errors: [] });
  });

  it('reports errors by path, without echoing the data values (no PII leak)', () => {
    const r = validateData(schema, { id: 5, total: -1, secret_ssn: '123-45-6789' });
    expect(r.valid).toBe(false);
    const paths = r.errors.map((e) => e.path);
    expect(paths).toContain('/id'); // must be string
    // the offending SSN value must not appear anywhere in the error report
    expect(JSON.stringify(r.errors)).not.toContain('123-45-6789');
  });

  it('flags an invalid JSON Schema itself', () => {
    const r = validateData({ type: 'not-a-real-type' }, {});
    expect(r.valid).toBe(false);
    expect(r.errors[0]!.path).toBe('(schema)');
  });
});
