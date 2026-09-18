export const loadResource = (fileNamespace: string) =>
  import(`../locales/uk-UA/${fileNamespace}.json`)
