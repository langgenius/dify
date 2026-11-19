const FLAG_WORD_SEPARATOR = '-'
const PROPERTY_WORD_SEPARATOR = '_'
const FLAG_PREFIX = '--'
const ARG_OPEN = '<'
const ARG_CLOSE = '>'

/** The name a typed word stands for: dashes are an alias for the underscores ids use. */
export function propertyFor(name: string): string {
  return name.split(FLAG_WORD_SEPARATOR).join(PROPERTY_WORD_SEPARATOR)
}

/** The flag a property name is typed as: ids spell underscores, flags spell dashes. */
export function flagFor(name: string): string {
  return name.split(PROPERTY_WORD_SEPARATOR).join(FLAG_WORD_SEPARATOR)
}

export function flagToken(name: string): string {
  return `${FLAG_PREFIX}${flagFor(name)}`
}

export function argToken(name: string): string {
  return `${ARG_OPEN}${name}${ARG_CLOSE}`
}

export function typedName(name: string, positional: readonly string[]): string {
  return positional.includes(name) ? argToken(name) : flagToken(name)
}
