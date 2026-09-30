export const loadResource = (fileNamespace: string) =>
  import(`../locales/sl-SI/${fileNamespace}.json`)
