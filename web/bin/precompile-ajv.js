const fs = require('node:fs')
const path = require('node:path')
const Ajv = require('ajv')
const standaloneCode = require('ajv/dist/standalone').default

const ajv = new Ajv({
  allErrors: true,
  verbose: true,
  code: { source: true, esm: true },
})

const moduleCode = standaloneCode(ajv, {
  validateDraft07: 'http://json-schema.org/draft-07/schema#',
})

const preamble = [
  '"use strict";',
].join('')
const imports = new Set()
const requireRegex = /const (\S+)\s*=\s*require\((.+)\)\.(\S+);/g
const replaced = moduleCode
  .replace(requireRegex, (_match, p1, p2, p3) => {
    imports.add(`import { ${p3} as ${p1} } from ${p2};`)
    return ''
  })
  .replace('"use strict";', '')

const uglyOutput = [preamble, Array.from(imports).join(''), replaced].join(
  '',
)

fs.writeFileSync(path.join(__dirname, '../public/validate-esm.mjs'), uglyOutput)
