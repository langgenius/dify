export const loadResource = (fileNamespace: string) =>
  import(`../../i18n/en-US/${fileNamespace}.json`)
