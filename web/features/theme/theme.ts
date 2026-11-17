export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

export const themeOptions = [
  { value: 'light', iconClassName: 'i-ri-sun-line', labelKey: 'theme.light' },
  { value: 'dark', iconClassName: 'i-ri-moon-line', labelKey: 'theme.dark' },
  { value: 'system', iconClassName: 'i-ri-computer-line', labelKey: 'theme.system' },
] as const satisfies readonly {
  value: ThemePreference
  iconClassName: string
  labelKey: `theme.${ThemePreference}`
}[]

export const isThemePreference = (value: unknown): value is ThemePreference =>
  themeOptions.some((option) => option.value === value)
