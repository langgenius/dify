import type { OrpcErrorEntry } from '../openapi-ts.api.config.ts'
/**
 * Declare each generated oRPC contract's documented errors with `.errors({...})`.
 *
 * `@hey-api/openapi-ts` emits `oc.route(...).input(...).output(...)` but has no option or
 * hook for error maps, so this runs after generation (and before formatting). For every
 * code of an operation's narrowed `{OperationId}Error{status}` components it declares
 * `{ status, data: z{OperationId}Error{status} }`, so clients can narrow errors with
 * `isDefinedError` once the link validates them against the contract.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { apiJobs, orpcErrorMaps } from '../openapi-ts.api.config.ts'

const contractsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const routeOperationId = (expression: ts.Expression): string | undefined => {
  let current: ts.Node = expression
  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    if (current.expression.name.text === 'route') {
      const options = current.arguments[0]
      if (!options || !ts.isObjectLiteralExpression(options)) return undefined
      for (const property of options.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === 'operationId' &&
          ts.isStringLiteral(property.initializer)
        )
          return property.initializer.text
      }
      return undefined
    }
    current = current.expression.expression
  }
  return undefined
}

const exportedNames = (source: string): Set<string> => {
  const names = new Set<string>()
  for (const match of source.matchAll(/^export const (\w+)/gm)) if (match[1]) names.add(match[1])
  return names
}

/**
 * The generator re-cases schema names (`A709B7A1` can become `A709b7a1`), so look the zod
 * export up case-insensitively. A missing or ambiguous name fails generation instead of
 * silently dropping the error body from the contract.
 */
const zodNameResolver = (zodNames: Set<string>, zodPath: string) => {
  const byLowerName = new Map<string, string[]>()
  for (const name of zodNames) {
    const key = name.toLowerCase()
    byLowerName.set(key, [...(byLowerName.get(key) ?? []), name])
  }
  return (schemaName: string): string => {
    const wanted = `z${schemaName}`
    if (zodNames.has(wanted)) return wanted
    const candidates = byLowerName.get(wanted.toLowerCase()) ?? []
    if (candidates.length === 1 && candidates[0]) return candidates[0]
    throw new Error(
      candidates.length === 0
        ? `${zodPath} exports no zod schema for error component ${schemaName}`
        : `${zodPath} exports several zod schemas for error component ${schemaName}: ${candidates.join(', ')}`,
    )
  }
}

const renderErrors = (
  entries: OrpcErrorEntry[],
  resolveZodName: (schemaName: string) => string,
  used: Set<string>,
): string => {
  const props = entries.map(({ code, schemaName, status }) => {
    const zodName = resolveZodName(schemaName)
    used.add(zodName)
    return `${JSON.stringify(code)}: { status: ${status}, data: ${zodName} }`
  })
  return `.errors({ ${props.join(', ')} })`
}

const patchContractFile = (directory: string, errorMaps: Map<string, OrpcErrorEntry[]>): number => {
  const orpcPath = path.join(directory, 'orpc.gen.ts')
  const zodPath = path.join(directory, 'zod.gen.ts')
  if (!fs.existsSync(orpcPath) || !fs.existsSync(zodPath)) return 0

  let source = fs.readFileSync(orpcPath, 'utf8')
  const file = ts.createSourceFile(orpcPath, source, ts.ScriptTarget.Latest, true)
  const resolveZodName = zodNameResolver(exportedNames(fs.readFileSync(zodPath, 'utf8')), zodPath)
  const used = new Set<string>()
  const insertions: { at: number; text: string }[] = []

  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer) continue
      const operationId = routeOperationId(declaration.initializer)
      const entries = operationId ? errorMaps.get(operationId) : undefined
      if (entries)
        insertions.push({
          at: declaration.initializer.end,
          text: renderErrors(entries, resolveZodName, used),
        })
    }
  }
  for (const { at, text } of insertions.sort((left, right) => right.at - left.at))
    source = `${source.slice(0, at)}${text}${source.slice(at)}`

  if (used.size > 0) {
    const importLine = `import { ${[...used].sort().join(', ')} } from './zod.gen.ts'\n`
    const firstImport = source.indexOf('import ')
    source = `${source.slice(0, firstImport)}${importLine}${source.slice(firstImport)}`
  }
  fs.writeFileSync(orpcPath, source)
  return insertions.length
}

const ambiguous: string[] = []
let patched = 0
for (const job of apiJobs) {
  if (job.plugins) continue // the console entry job writes loaders, not contracts
  const { ambiguous: jobAmbiguous, errorMaps } = orpcErrorMaps(job.document)
  ambiguous.push(...jobAmbiguous)
  patched += patchContractFile(path.join(contractsDir, job.outputPath), errorMaps)
}
process.stdout.write(`declared error maps on ${patched} contracts\n`)
if (ambiguous.length > 0)
  process.stdout.write(
    `codes left undefined because one operation documents them under several statuses:\n  ${ambiguous.join('\n  ')}\n`,
  )
