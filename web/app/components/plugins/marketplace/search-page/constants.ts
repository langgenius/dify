export type LanguageOption = {
  value: string
  label: string
  nativeLabel: string
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: 'en', label: 'English', nativeLabel: 'English' },
  { value: 'zh-Hans', label: 'Simplified Chinese', nativeLabel: '简体中文' },
  { value: 'zh-Hant', label: 'Traditional Chinese', nativeLabel: '繁體中文' },
  { value: 'ja', label: 'Japanese', nativeLabel: '日本語' },
  { value: 'es', label: 'Spanish', nativeLabel: 'Español' },
  { value: 'fr', label: 'French', nativeLabel: 'Français' },
  { value: 'ko', label: 'Korean', nativeLabel: '한국어' },
]
