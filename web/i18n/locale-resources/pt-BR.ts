export const loadResource = (fileNamespace: string) =>
  import(`../locales/pt-BR/${fileNamespace}.json`)
