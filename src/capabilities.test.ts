import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SOURCE_REPAIR_CAPABILITY,
  runtimeCapabilities,
  sourceRepairDeniedPayload
} from './capabilities.js';

test('source repair is an immutable certified runtime capability', () => {
  assert.equal(SOURCE_REPAIR_CAPABILITY.enabled, true);
  assert.equal(SOURCE_REPAIR_CAPABILITY.code, 'SOURCE_REPAIR_CERTIFIED');
  assert.equal(Object.isFrozen(SOURCE_REPAIR_CAPABILITY), true);
  assert.match(SOURCE_REPAIR_CAPABILITY.reason, /certified/i);
  assert.ok(Array.isArray(SOURCE_REPAIR_CAPABILITY.evidenceIds));
  assert.ok((SOURCE_REPAIR_CAPABILITY.evidenceIds || []).length >= 1);
  assert.ok(SOURCE_REPAIR_CAPABILITY.certifiedAt);

  const capabilities = runtimeCapabilities();
  assert.equal(Object.isFrozen(capabilities), true);
  assert.equal(capabilities.sourceRepair, SOURCE_REPAIR_CAPABILITY);

  const denial = sourceRepairDeniedPayload();
  assert.equal(denial.code, SOURCE_REPAIR_CAPABILITY.code);
  assert.equal(denial.error, SOURCE_REPAIR_CAPABILITY.reason);
  assert.equal(denial.capability.enabled, true);
});
