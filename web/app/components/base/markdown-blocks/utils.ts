export const isValidUrl = (url: string): boolean => {
  return ['http:', 'https:', '//', 'mailto:'].some(prefix => url.startsWith(prefix))
}
