export const loadResource = (fileNamespace: string) =>
  import(`../locales/lo-LA/${fileNamespace}.json`)
