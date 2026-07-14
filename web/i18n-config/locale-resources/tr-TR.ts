export const loadResource = (fileNamespace: string) =>
  import(`../../i18n/tr-TR/${fileNamespace}.json`)
