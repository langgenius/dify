export const loadResource = (fileNamespace: string) =>
  import(`../../i18n/sv-SE/${fileNamespace}.json`)
