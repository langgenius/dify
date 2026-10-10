const FLAG_WORD_SEPARATOR = '-'
const PROPERTY_WORD_SEPARATOR = '_'

/** The name a typed word stands for: dashes are an alias for the underscores ids use. */
export function propertyFor(name: string): string {
  return name.split(FLAG_WORD_SEPARATOR).join(PROPERTY_WORD_SEPARATOR)
}

/** The flag a property name is typed as: ids spell underscores, flags spell dashes. */
export function flagFor(name: string): string {
  return name.split(PROPERTY_WORD_SEPARATOR).join(FLAG_WORD_SEPARATOR)
}
