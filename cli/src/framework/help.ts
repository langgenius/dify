import type { CommandConstructor } from './command.js'
import type { FlagDefinition } from './types.js'

function flagLabel(name: string, def: FlagDefinition): string {
  const parts: string[] = []

  if (def.char)
    parts.push(`-${def.char}`)

  parts.push(`--${name}`)

  if (def.type !== 'boolean')
    parts.push(`<${def.type}>`)

  return parts.join(', ')
}

function flagDefault(def: FlagDefinition): string {
  if (def.default === undefined)
    return ''

  return ` [default: ${JSON.stringify(def.default)}]`
}

export function formatHelp(ctor: CommandConstructor, path: string): string {
  const lines: string[] = []
  const bin = 'difyctl'

  if (ctor.description)
    lines.push(ctor.description, '')

  lines.push('USAGE', `  $ ${bin} ${path}${ctor.args && Object.keys(ctor.args).length > 0 ? ' [ARGS]' : ''}${ctor.flags && Object.keys(ctor.flags).length > 0 ? ' [FLAGS]' : ''}`, '')

  if (ctor.args && Object.keys(ctor.args).length > 0) {
    lines.push('ARGUMENTS')

    for (const [name, def] of Object.entries(ctor.args)) {
      const required = def.required ? ' (required)' : ''
      lines.push(`  ${name}${required}  ${def.description}`)
    }

    lines.push('')
  }

  if (ctor.flags && Object.keys(ctor.flags).length > 0) {
    lines.push('FLAGS')

    for (const [name, def] of Object.entries(ctor.flags)) {
      lines.push(`  ${flagLabel(name, def)}  ${def.description}${flagDefault(def)}`)
    }

    lines.push('')
  }

  if (ctor.examples && ctor.examples.length > 0) {
    lines.push('EXAMPLES')

    for (const ex of ctor.examples) {
      lines.push(`  $ ${ex.replace('<%= config.bin %>', bin)}`)
    }

    lines.push('')
  }

  const C = ctor
  const guide = ((new C())).agentGuide()

  if (typeof guide === 'string' && guide.length > 0)
    lines.push(guide)

  return lines.join('\n')
}
