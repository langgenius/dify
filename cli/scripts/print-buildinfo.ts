import { resolveBuildInfo } from './lib/resolve-buildinfo.js'

const info = resolveBuildInfo()
process.stdout.write(
  `version:  ${info.version}\n`
  + `commit:   ${info.commit}\n`
  + `built:    ${info.buildDate}\n`
  + `channel:  ${info.channel}\n`,
)
