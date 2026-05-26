import { ENV_REGISTRY } from '../../../env/registry.js'

export function runHelpEnvironment(): string {
  let out = 'ENVIRONMENT VARIABLES\n\n'
  for (const v of ENV_REGISTRY) {
    out += `  ${v.name}\n      ${v.description}\n`
    if (v.sensitive)
      out += '      (treat as secret; never echoed)\n'
    out += '\n'
  }
  return out
}
