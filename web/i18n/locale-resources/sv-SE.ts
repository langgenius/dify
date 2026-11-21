export const loadResource = async (fileNamespace: string) => {
  try {
    return await import(`../locales/sv-SE/${fileNamespace}.json`)
  } catch {
    return import(`../locales/en-US/${fileNamespace}.json`)
  }
}
