import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  BRAIN_GUIDANCE_VERSION,
  CANONICAL_LAW_COUNT,
  CANONICAL_LAW_VERSION,
  CANONICAL_LAW_FAMILIES,
  DEFAULT_BRAIN_GUIDANCE_PRESET_ID,
  brainGuidancePrompt,
  getBrainGuidancePreset,
  listBrainGuidancePresets
} from './brainPresets.js';

const lawSpec = JSON.parse(fs.readFileSync('plan/ratified-1.3.1/spec/rules.json', 'utf8')) as {
  specVersion: string;
  rules: Array<{ id: string }>;
};
const registryFamilies = [...new Set(lawSpec.rules.map(law => law.id.split('-').slice(0, 2).join('-')))].sort();
const guidanceFields = [
  'purpose', 'preferences', 'environment', 'architecture',
  'constraints', 'decisions', 'knownIssues', 'verifiedTruth'
] as const;

test('Project Brain presets preserve the complete canonical law foundation', () => {
  assert.equal(lawSpec.rules.length, CANONICAL_LAW_COUNT);
  assert.equal(CANONICAL_LAW_VERSION, lawSpec.specVersion);
  assert.equal(BRAIN_GUIDANCE_VERSION, '1.3.2');
  assert.deepEqual([...CANONICAL_LAW_FAMILIES].sort(), registryFamilies);

  const presets = listBrainGuidancePresets();
  assert.equal(presets.length, 7);
  assert.equal(new Set(presets.map(preset => preset.id)).size, presets.length);
  assert.ok(presets.some(preset => preset.id === DEFAULT_BRAIN_GUIDANCE_PRESET_ID));

  for (const preset of presets) {
    assert.match(preset.id, /^brain-preset-[a-z0-9-]+$/);
    assert.deepEqual([...preset.lawFamilies].sort(), registryFamilies, `${preset.name} keeps every law family`);
    assert.equal(preset.lawVersion, lawSpec.specVersion);
    assert.equal(preset.lawCount, CANONICAL_LAW_COUNT);
    for (const field of guidanceFields) {
      assert.ok(preset.guidance[field].trim().length > 80, `${preset.name}.${field} has substantive guidance`);
    }
    assert.match(preset.guidance.constraints, /authorization|authorize/i);
    assert.match(preset.guidance.verifiedTruth, /preset verifies nothing/i);
  }
});

test('Project Brain guidance is operational context, never authority or proof', () => {
  const repair = getBrainGuidancePreset('brain-preset-repair-finish');
  const prompt = brainGuidancePrompt(repair.id);
  assert.match(prompt, /48 ratified laws, no preset may weaken them/i);
  assert.match(prompt, /Evidence outranks narrative/i);
  assert.match(prompt, /Focused guidance: Define the failing user-visible behavior/i);
  assert.match(prompt, /This preset verifies nothing/i);
  assert.equal(getBrainGuidancePreset('brain-preset-does-not-exist').id, DEFAULT_BRAIN_GUIDANCE_PRESET_ID);

  const detached = listBrainGuidancePresets();
  (detached[0]!.guidance as { purpose: string }).purpose = 'changed by caller';
  assert.notEqual(listBrainGuidancePresets()[0]!.guidance.purpose, 'changed by caller');
});