export const loadResource = (fileNamespace: string) =>
  import(`../locales/es-ES/${fileNamespace}.json`)
