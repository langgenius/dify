export const OP_SEPARATOR = '.'
export const COMMAND_SEPARATOR = ' '

/** An op id as the words it is typed as: `console_app.list` -> `console_app list`. */
export function spacedId(id: string): string {
  return id.split(OP_SEPARATOR).join(COMMAND_SEPARATOR)
}

export function dottedId(path: readonly string[]): string {
  return path.join(OP_SEPARATOR)
}
