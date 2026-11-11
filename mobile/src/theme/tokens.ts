import type { TextStyle, ViewStyle } from 'react-native';

export const colors = {
  canvas: '#F7FAF5',
  surface: '#FFFFFF',
  surfaceMuted: '#F0F6EF',
  mintSoft: '#D5F2D3',
  mint: '#B5E4B7',
  greenSoft: '#91D99A',
  primary: '#205C3B',
  primaryPressed: '#17472E',
  primarySoft: '#DDEEDF',
  border: '#D8E4D8',
  borderStrong: '#B7C9B9',
  textPrimary: '#1D2921',
  textSecondary: '#5B6B60',
  textDisabled: '#89958D',
  income: '#237A4B',
  expense: '#B33A4E',
  savings: '#356AA0',
  warning: '#936200',
  risk: '#B64B12',
  error: '#B42318',
  successSurface: '#E4F5E8',
  warningSurface: '#FFF4D6',
  errorSurface: '#FDE9E7',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 40 } as const;
export const radii = { sm: 8, control: 12, surface: 16, pill: 999 } as const;
export const borders = { hairline: 1, emphasized: 2 } as const;
export const controlHeights = { minimum: 44, standard: 48 } as const;

export const typography = {
  financialDisplay: { fontSize: 32, lineHeight: 38, fontWeight: '700' },
  screenTitle: { fontSize: 26, lineHeight: 32, fontWeight: '700' },
  sectionTitle: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  supporting: { fontSize: 13, lineHeight: 19, fontWeight: '400' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  button: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
} as const satisfies Record<string, TextStyle>;

export const elevation = {
  none: {} satisfies ViewStyle,
  raised: {
    shadowColor: '#1D2921',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  } satisfies ViewStyle,
} as const;
