export const cleanJsonText = (text) => {
  const cleaned = text.replaceAll(/,\s*\}/g, '}')
  try {
    JSON.parse(cleaned)
    return cleaned
  }
  catch {
    return text
  }
}
