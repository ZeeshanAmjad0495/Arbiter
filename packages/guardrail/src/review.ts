import type { ReviewRecord, RiskTier } from '@arbiter/core';

export interface ReviewGateInput {
  readonly riskTier: RiskTier;
  /** True when grounding found ungrounded claims and blocks export. */
  readonly groundingBlocked: boolean;
  /** Demo/hello mode — force approval so a run completes without a human. */
  readonly autoApprove?: boolean;
}

export interface ReviewGate {
  decide(input: ReviewGateInput): ReviewRecord;
}

/**
 * Risk-tiered review policy (§8): high/medium risk require pre-approval (start
 * `pending`); low risk is usable immediately but flagged for ~sampled post-hoc
 * audit. Any grounding violation forces `needs_changes` regardless of tier —
 * an ungrounded artifact can never auto-pass.
 */
export class PolicyReviewGate implements ReviewGate {
  decide(input: ReviewGateInput): ReviewRecord {
    if (input.groundingBlocked) {
      return { decision: 'needs_changes', riskTier: input.riskTier, mode: 'pre_approval' };
    }
    if (input.autoApprove) {
      return { decision: 'approved', riskTier: input.riskTier, mode: 'auto' };
    }
    if (input.riskTier === 'high' || input.riskTier === 'medium') {
      return { decision: 'pending', riskTier: input.riskTier, mode: 'pre_approval' };
    }
    return { decision: 'approved', riskTier: input.riskTier, mode: 'post_hoc_sample' };
  }
}
