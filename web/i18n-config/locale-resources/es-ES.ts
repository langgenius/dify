export const loadResource = (fileNamespace: string) =>
  import(`../../i18n/es-ES/${fileNamespace}.json`)
