import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export interface ValidateError {
  path: string;
  message: string;
  keyword: string;
}
export interface ValidateResult {
  valid: boolean;
  errors: ValidateError[];
}

/**
 * Validate a parsed data value against a user-provided JSON Schema (ajv).
 * A fresh Ajv per call avoids cross-schema $id collisions and cache growth.
 * Errors report the data PATH and the constraint — never the data values — so a
 * validation report can't leak PII.
 */
export function validateData(schema: unknown, data: unknown): ValidateResult {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  let validate: ReturnType<typeof ajv.compile>;
  try {
    validate = ajv.compile(schema as object);
  } catch (e) {
    return {
      valid: false,
      errors: [{ path: '(schema)', message: `Invalid JSON Schema: ${e instanceof Error ? e.message : String(e)}`, keyword: 'schema' }],
    };
  }

  const valid = validate(data) as boolean;
  const errors: ValidateError[] = (validate.errors ?? []).map((err) => ({
    path: err.instancePath || '(root)',
    message: err.message ?? 'is invalid',
    keyword: err.keyword,
  }));
  return { valid, errors };
}
