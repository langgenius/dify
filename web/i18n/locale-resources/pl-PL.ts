export const loadResource = (fileNamespace: string) =>
  import(`../locales/pl-PL/${fileNamespace}.json`)
