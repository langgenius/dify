import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// Only explicitly documented, literal-code error responses become defined errors.
// A generic ErrorBody with code: string must remain an unknown-error fallback.
export function errorContractsFor(document) {
  const operations = {}
  for (const item of Object.values(document.paths ?? {})) {
    for (const operation of Object.values(item)) {
      if (!operation?.operationId || operation['x-dify-typed-errors'] !== true) continue
      const errors = {}
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (!/^[45]\d{2}$/.test(status)) continue
        const ref = response.content?.['application/json']?.schema?.$ref
        if (!ref?.startsWith('#/components/schemas/')) continue
        const name = ref.split('/').at(-1)
        const schema = document.components?.schemas?.[name]
        const code = schema?.properties?.code
        const literal = code?.const ?? (code?.enum?.length === 1 ? code.enum[0] : undefined)
        if (typeof literal !== 'string' || !literal) continue
        if (errors[literal])
          throw new Error(`Duplicate error code ${literal} in ${operation.operationId}`)
        errors[literal] = { status: Number(status), schema: `z${name}` }
      }
      if (Object.keys(errors).length) operations[operation.operationId] = errors
    }
  }
  return operations
}

export function addErrorContracts(source, operations) {
  const file = ts.createSourceFile('orpc.gen.ts', source, ts.ScriptTarget.Latest, true)
  const insertions = []
  const remaining = new Set(Object.keys(operations))
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer) continue
      let operationId
      function visit(node) {
        if (
          ts.isPropertyAssignment(node) &&
          node.name.getText(file) === 'operationId' &&
          ts.isStringLiteral(node.initializer)
        )
          operationId = node.initializer.text
        ts.forEachChild(node, visit)
      }
      visit(declaration.initializer)
      const errors = operations[operationId]
      if (!errors) continue
      remaining.delete(operationId)
      const entries = Object.entries(errors).map(
        ([code, error]) =>
          `${JSON.stringify(code)}: { status: ${error.status}, data: errorSchemas.${error.schema} }`,
      )
      insertions.push({ at: declaration.initializer.end, text: `.errors({${entries.join(',')}})` })
    }
  }
  if (remaining.size)
    throw new Error(`Error contracts missing generated operations: ${[...remaining].join(', ')}`)
  for (const insertion of insertions.sort((a, b) => b.at - a.at))
    source = source.slice(0, insertion.at) + insertion.text + source.slice(insertion.at)
  return insertions.length
    ? source.replace('\n', "\n\nimport * as errorSchemas from './zod.gen.ts'\n")
    : source
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputPath = process.argv[2]
  const operations = JSON.parse(process.argv[3])
  const contractPath = path.join(outputPath, 'orpc.gen.ts')
  const schemas = fs.readFileSync(path.join(outputPath, 'zod.gen.ts'), 'utf8')
  for (const errors of Object.values(operations)) {
    for (const error of Object.values(errors)) {
      if (!schemas.includes(`export const ${error.schema} =`))
        throw new Error(`Missing generated error schema: ${error.schema}`)
    }
  }
  fs.writeFileSync(
    contractPath,
    addErrorContracts(fs.readFileSync(contractPath, 'utf8'), operations),
  )
}
