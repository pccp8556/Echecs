export interface BoardTheme {
  id: string;
  label: string;
  light: string;
  dark: string;
  /** Couleur des coordonnées sur cases claires / foncées. */
  coordLight: string;
  coordDark: string;
}

export const BOARD_THEMES: BoardTheme[] = [
  { id: 'emeraude', label: 'Émeraude', light: '#e9ede2', dark: '#5f927e', coordLight: '#5f927e', coordDark: '#e9ede2' },
  { id: 'ardoise', label: 'Ardoise', light: '#dfe5ec', dark: '#768ca8', coordLight: '#768ca8', coordDark: '#dfe5ec' },
  { id: 'bois', label: 'Bois clair', light: '#f0d9b5', dark: '#b58863', coordLight: '#b58863', coordDark: '#f0d9b5' },
  { id: 'nuit', label: 'Nuit', light: '#a9b8c6', dark: '#40566d', coordLight: '#40566d', coordDark: '#a9b8c6' },
  { id: 'turquoise', label: 'Lagon', light: '#e2f1ee', dark: '#3e9b92', coordLight: '#3e9b92', coordDark: '#e2f1ee' },
  { id: 'marbre', label: 'Marbre', light: '#eceae6', dark: '#9c9a95', coordLight: '#8a8883', coordDark: '#f2f0ec' },
  { id: 'contraste', label: 'Contraste élevé', light: '#ffffff', dark: '#3f6b5c', coordLight: '#1f3b32', coordDark: '#ffffff' },
];

export function boardTheme(id: string): BoardTheme {
  return BOARD_THEMES.find((t) => t.id === id) ?? BOARD_THEMES[0];
}

export const SHAPE_COLORS: Record<string, string> = {
  G: '#1fa25a',
  R: '#d93a3a',
  Y: '#e8a317',
  B: '#2f6fe0',
};
