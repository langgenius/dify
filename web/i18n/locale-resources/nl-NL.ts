export const loadResource = (fileNamespace: string) =>
  import(`../locales/nl-NL/${fileNamespace}.json`)
