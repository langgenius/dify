export const loadResource = (fileNamespace: string) =>
  import('../../i18n/lo-LA/${fileNamespace}.json')
