export const loadResource = (fileNamespace: string) =>
  import(`../locales/az-AZ/${fileNamespace}.json`)
