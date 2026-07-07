import type { ContextPack, GroundingClaim, GroundingReport } from '@arbiter/core';

export interface GroundingClaimInput {
  readonly kind: GroundingClaim['kind'];
  readonly value: string;
}

export interface GroundingValidator {
  validate(claims: readonly GroundingClaimInput[], pack: ContextPack, opts?: { blockOnViolation?: boolean }): GroundingReport;
}

/**
 * Phase 0 grounding validator: a claimed field/endpoint/requirement is "grounded"
 * iff its value appears (case-insensitive) in some context-pack item. This is the
 * mechanism behind the "invented field is unexportable" guarantee (§2). Phase 2
 * swaps in schema/spec/tracker-aware checks behind this same interface.
 */
export class SubstringGroundingValidator implements GroundingValidator {
  validate(
    claims: readonly GroundingClaimInput[],
    pack: ContextPack,
    opts: { blockOnViolation?: boolean } = {},
  ): GroundingReport {
    const blockOnViolation = opts.blockOnViolation ?? true;
    const haystack = pack.items.map((i) => i.content.toLowerCase());

    const evaluated: GroundingClaim[] = claims.map((claim) => {
      const needle = claim.value.trim().toLowerCase();
      if (needle.length === 0) {
        return { kind: claim.kind, value: claim.value, status: 'unknown' };
      }
      const idx = haystack.findIndex((h) => h.includes(needle));
      return idx >= 0
        ? { kind: claim.kind, value: claim.value, status: 'grounded', foundIn: pack.items[idx]?.id }
        : { kind: claim.kind, value: claim.value, status: 'ungrounded' };
    });

    const violations = evaluated.filter((c) => c.status === 'ungrounded').length;
    return {
      claims: evaluated,
      violations,
      blockedExport: blockOnViolation && violations > 0,
    };
  }
}
