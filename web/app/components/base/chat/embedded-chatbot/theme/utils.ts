export function hexToRGBA(hex: string, opacity: number): string {
  hex = hex.replace('#', '')

  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)

  // Returning an RGB color object
  return `rgba(${r},${g},${b},${opacity.toString()})`
}

/**
 * Since strings cannot be directly assigned to the 'style' attribute in JSX,
 * this method transforms the string into an object representation of the styles.
 */
export function CssTransform(cssString: string): object {
  if (cssString.length === 0)
    return {}

  const style: object = {}
  const propertyValuePairs = cssString.split(';')
  for (const pair of propertyValuePairs) {
    if (pair.trim().length > 0) {
      const [property, value] = pair.split(':')
      Object.assign(style, { [property.trim()]: value.trim() })
    }
  }
  return style
}
