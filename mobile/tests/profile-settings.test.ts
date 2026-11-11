import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProfileMoney, validateFinancialProfile } from '../src/lib/validation/profile';
import { createProfileSettingsController, type ProfileSettingsState } from '../src/lib/services/profile-settings-ui';

const saved = { monthlyIncome: 120_000, emergencyFundTarget: 240_000 };
function fixture(overrides: Partial<Parameters<typeof createProfileSettingsController>[0]> = {}) {
  const states: ProfileSettingsState[] = [];
  const writes: typeof saved[] = [];
  const controller = createProfileSettingsController({ load: async () => saved,
    save: async input => { writes.push(input); return input; }, changed: state => states.push(state), ...overrides });
  return { controller, states, writes };
}

test('profile settings: loads saved values and saves both validated fields with success state', async () => {
  const { controller, states, writes } = fixture();
  await controller.load();
  assert.equal(controller.getState().monthlyIncome, '120000');
  assert.equal(controller.getState().emergencyFundTarget, '240000');
  controller.edit('monthlyIncome', '50000'); controller.edit('emergencyFundTarget', '0');
  await controller.save();
  assert.deepEqual(writes, [{ monthlyIncome: 50_000, emergencyFundTarget: 0 }]);
  assert.ok(states.some(s => s.saving));
  assert.equal(controller.getState().saving, false);
  assert.match(controller.getState().notice!, /saved/);
  controller.edit('monthlyIncome', '60000');
  assert.equal(controller.getState().notice, null);
});

test('profile settings: empty, malformed, fractional, negative and excessive amounts never write', async () => {
  for (const field of ['monthlyIncome', 'emergencyFundTarget'] as const) {
    for (const value of ['', ' ', '-1', '+2', '1.5', '1e6', 'NaN', '120,000', '2147483648', '99999999999999999999999']) {
      const { controller, writes } = fixture(); await controller.load();
      controller.edit(field, value); await controller.save();
      assert.equal(writes.length, 0, `${field}: ${value}`);
      assert.ok(controller.getState().error);
      assert.equal(controller.getState()[field], value);
      assert.equal(controller.getState().saving, false);
    }
  }
  assert.equal(parseProfileMoney('0', 'monthlyIncome'), 0);
  assert.equal(parseProfileMoney('2147483647', 'emergencyFundTarget'), 2_147_483_647);
  for (const value of [null, undefined, '', -1, 1.5, NaN, Infinity, 2_147_483_648]) {
    assert.throws(() => validateFinancialProfile({ monthlyIncome: value as number, emergencyFundTarget: 0 }));
  }
});

test('profile settings: missing data stays unconfigured while saved zero remains explicit', async () => {
  const missing = fixture({ load: async () => null }); await missing.controller.load();
  assert.equal(missing.controller.getState().profile, null);
  assert.equal(missing.controller.getState().monthlyIncome, '');
  await missing.controller.save(); assert.equal(missing.writes.length, 0);
  const zero = fixture({ load: async () => ({ monthlyIncome: 0, emergencyFundTarget: 0 }) });
  await zero.controller.load();
  assert.equal(zero.controller.getState().monthlyIncome, '0');
  assert.equal(zero.controller.getState().emergencyFundTarget, '0');
});

test('profile settings: load failures are recoverable and saving before load is blocked', async () => {
  let failures = true;
  const { controller, writes } = fixture({ load: async () => { if (failures) throw new Error('private SQL'); return saved; } });
  await controller.save(); assert.equal(writes.length, 0);
  await controller.load(); assert.equal(controller.getState().loaded, false);
  assert.match(controller.getState().error!, /Could not load/);
  assert.doesNotMatch(controller.getState().error!, /private/);
  failures = false; await controller.load(); assert.equal(controller.getState().loaded, true);
});

test('profile settings: failed saves retain edits, permit retry, and never claim success', async () => {
  let fail = true;
  const { controller } = fixture({ save: async input => { if (fail) throw new Error('private SQL'); return input; } });
  await controller.load(); controller.edit('monthlyIncome', '0'); await controller.save();
  assert.equal(controller.getState().profile!.monthlyIncome, saved.monthlyIncome);
  assert.equal(controller.getState().monthlyIncome, '0');
  assert.equal(controller.getState().notice, null);
  assert.match(controller.getState().error!, /Could not save/);
  fail = false; await controller.save(); assert.equal(controller.getState().profile!.monthlyIncome, 0);
});

test('profile settings: synchronous submission lock prevents duplicate saves and overlapping reloads', async () => {
  let release!: (value: typeof saved) => void;
  let saves = 0, loads = 0;
  const { controller } = fixture({ load: async () => { loads++; return saved; },
    save: input => { saves++; return new Promise(resolve => { release = resolve; }); } });
  await controller.load(); const first = controller.save();
  await controller.save(); await controller.load(); controller.edit('monthlyIncome', '9');
  assert.equal(saves, 1); assert.equal(loads, 1);
  assert.equal(controller.getState().monthlyIncome, '120000');
  release(saved); await first; assert.equal(controller.getState().saving, false);
});
