export const OP_SEPARATOR = '.'
export const COMMAND_SEPARATOR = ' '

export function commandWords(id: string): readonly string[] {
  return id.split(OP_SEPARATOR)
}

/** An op id as the words it is typed as: `get.console_app` -> `get console_app`. */
export function spacedId(id: string): string {
  return commandWords(id).join(COMMAND_SEPARATOR)
}

export function dottedId(path: readonly string[]): string {
  return path.join(OP_SEPARATOR)
}
