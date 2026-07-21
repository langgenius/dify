export const loadResource = (fileNamespace: string) =>
  import(`../../i18n/pl-PL/${fileNamespace}.json`)
