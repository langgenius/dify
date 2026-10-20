export const loadResource = (fileNamespace: string) =>
  import(`../locales/en-US/${fileNamespace}.json`)
