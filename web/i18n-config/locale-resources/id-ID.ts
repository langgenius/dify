export const loadResource = (fileNamespace: string) =>
  import(`../../i18n/id-ID/${fileNamespace}.json`)
