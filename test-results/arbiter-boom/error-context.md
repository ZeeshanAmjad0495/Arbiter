# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: arbiter.spec.js >> boom
- Location: ../../../../../../../private/var/folders/54/bjy03px55wjgg2bs705ngtth0000gp/T/arbiter-run-Tq70k4/arbiter.spec.js:2:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 2
Received: 1
```

# Test source

```ts
  1 | import { test, expect } from '@playwright/test';
> 2 | test('boom', async () => { expect(1).toBe(2); });
    |                                      ^ Error: expect(received).toBe(expected) // Object.is equality
```