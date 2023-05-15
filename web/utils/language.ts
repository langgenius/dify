type Item = {
  value: number | string
  name: string
}
export const languages: Item[] = [
  {
    value: 'en-US',
    name: 'English(United States)',
  },
  {
    value: 'zh-Hans',
    name: '简体中文',
  },
]

export const languageMaps = {
  'en': 'en-US',
  'zh-Hans': 'zh-Hans',
}
