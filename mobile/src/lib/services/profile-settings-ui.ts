import { parseProfileMoney, type FinancialProfileInput, type ProfileField } from '../validation/profile';

export type ProfileSettingsState = {
  loaded: boolean; loading: boolean; saving: boolean;
  profile: FinancialProfileInput | null;
  monthlyIncome: string; emergencyFundTarget: string;
  error: string | null; notice: string | null;
};
export const initialProfileSettingsState: ProfileSettingsState = {
  loaded: false, loading: true, saving: false, profile: null,
  monthlyIncome: '', emergencyFundTarget: '', error: null, notice: null,
};
export function createProfileSettingsController(dependencies: {
  load: () => Promise<FinancialProfileInput | null>;
  save: (input: FinancialProfileInput) => Promise<FinancialProfileInput>;
  changed: (state: ProfileSettingsState) => void;
}) {
  let state = { ...initialProfileSettingsState };
  let active = false;
  const publish = (patch: Partial<ProfileSettingsState>) => {
    state = { ...state, ...patch }; dependencies.changed(state);
  };
  async function load() {
    if (active) return;
    active = true;
    publish({ loading: true, error: null, notice: null });
    try {
      const profile = await dependencies.load();
      publish({ loaded: true, profile, monthlyIncome: profile ? String(profile.monthlyIncome) : '',
        emergencyFundTarget: profile ? String(profile.emergencyFundTarget) : '' });
    } catch {
      publish({ loaded: false, error: 'Could not load financial settings. Try again.' });
    } finally { active = false; publish({ loading: false }); }
  }
  function edit(field: ProfileField, value: string) {
    if (active || !state.loaded || !state.profile) return;
    publish({ [field]: value, error: null, notice: null });
  }
  async function save() {
    if (active || !state.loaded || !state.profile) return;
    active = true;
    publish({ saving: true, error: null, notice: null });
    try {
      const input = { monthlyIncome: parseProfileMoney(state.monthlyIncome, 'monthlyIncome'),
        emergencyFundTarget: parseProfileMoney(state.emergencyFundTarget, 'emergencyFundTarget') };
      let saved: FinancialProfileInput;
      try { saved = await dependencies.save(input); }
      catch { publish({ error: 'Could not save financial settings. Your edits are still here; try again.' }); return; }
      publish({ profile: saved, monthlyIncome: String(saved.monthlyIncome), emergencyFundTarget: String(saved.emergencyFundTarget),
        notice: 'Financial settings saved. New calculations will use these values.' });
    } catch (error) {
      publish({ error: error instanceof Error ? error.message : 'Check both amounts and try again.' });
    } finally { active = false; publish({ saving: false }); }
  }
  return { load, edit, save, getState: () => state };
}
