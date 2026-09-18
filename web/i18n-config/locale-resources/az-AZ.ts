export const loadResource = (fileNamespace: string) =>
  import(`../../i18n/az-AZ/${fileNamespace}.json`)
