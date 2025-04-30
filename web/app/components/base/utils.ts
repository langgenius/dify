export const isCompleteHTML = (code: string): boolean => {
  /**
    * A simple check to determine if the input string is a complete HTML document.
    * This function supports optional <!DOCTYPE> declarations and comments before the <html> tag.
    * Note: This is not a full HTML validator and may not handle all edge cases.
    */
  const completeHTMLRegex = /^(?:<!DOCTYPE\s+html\s*[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<\s*html\s*[^>]*>[\s\S]*<\/html\s*>/i
  return completeHTMLRegex.test(code)
}

export const getPureContent = (code: string): string => {
  return String(code).replace(/\n$/, '').trim()
}
