export type LanguageOption = {
  value: string
  label: string
  nativeLabel: string
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: 'en', label: 'English', nativeLabel: 'English' },
  { value: 'zh-Hans', label: 'Simplified Chinese', nativeLabel: '中文' },
  { value: 'ja', label: 'Japanese', nativeLabel: '日本語' },
  { value: 'other', label: 'Other', nativeLabel: 'Other' },
]
