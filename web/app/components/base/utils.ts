export const isCompleteHTML = (code: string): boolean => {
  // simple check
  const completeHTMLRegex = /<\s*html\s*[^>]*>[\s\S]*<\/html\s*>/i
  return completeHTMLRegex.test(code)
}

export const getPureContent = (code: string): string => {
  return String(code).replace(/\n$/, '').trim()
}
