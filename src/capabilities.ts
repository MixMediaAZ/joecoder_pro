export interface RuntimeCapability {
  readonly enabled: boolean;
  readonly code: string;
  readonly reason: string;
  readonly nextStep: string;
  readonly certifiedAt?: string;
  readonly evidenceIds?: readonly string[];
}

/**
 * Source repair capability.
 *
 * Certification authority: CAPABILITY_CERTIFICATION.md
 * Handoff plan: HANDOFF_PLAN_v1.md
 * Driver: tools/certify-mutation.mjs
 *
 * Certified 2026-08-02 against three independent fixtures. Evidence IDs
 * (representative of the final run set):
 *   transaction:              CERT-1785660530689-transaction-0ce0bf
 *   authorization_envelope:   CERT-1785660533135-authorization_envelope-103116
 *   crash_recovery:           CERT-1785660534996-crash_recovery-62eb9a
 *   windows_path:             CERT-1785660536334-windows_path-5e0235
 *
 * Full evidence set lives under .jc/certification/.
 * This flag is intentionally not environment-configurable.
 */
export const SOURCE_REPAIR_CAPABILITY: Readonly<RuntimeCapability> = Object.freeze({
  enabled: true,
  code: 'SOURCE_REPAIR_CERTIFIED',
  reason: 'Source repair is certified: transaction, authorization envelope, crash recovery, path jail, verification, and structured routing controls passed.',
  nextStep: 'Draft a repair Work Order against a verified survey, authorize the exact scope, then run the authorized apply.',
  certifiedAt: '2026-08-02',
  evidenceIds: Object.freeze([
    'CERT-1785660530689-transaction-0ce0bf',
    'CERT-1785660533135-authorization_envelope-103116',
    'CERT-1785660534996-crash_recovery-62eb9a',
    'CERT-1785660536334-windows_path-5e0235'
  ])
});

export function runtimeCapabilities(): Readonly<{ sourceRepair: Readonly<RuntimeCapability> }> {
  return Object.freeze({ sourceRepair: SOURCE_REPAIR_CAPABILITY });
}

export function sourceRepairDeniedPayload(): {
  error: string;
  code: string;
  capability: Readonly<RuntimeCapability>;
} {
  return {
    error: SOURCE_REPAIR_CAPABILITY.reason,
    code: SOURCE_REPAIR_CAPABILITY.code,
    capability: SOURCE_REPAIR_CAPABILITY
  };
}
