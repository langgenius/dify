import type { OrpcErrorEntry } from '../openapi-ts.api.config.ts'
/**
 * Patch the generated oRPC contracts with what `@hey-api/openapi-ts` has no option or hook for,
 * so this runs after generation (and before formatting):
 *
 * - Documented errors, as `.errors({...})`. For every per-code `{Code}Error` component an
 *   operation's error responses reference it declares `{ data: z{Code}Error }`, so clients can
 *   narrow errors with `isDefinedError` once the link reconciles them against the contract.
 *   oRPC v2 error maps carry no HTTP status; the backend body still documents it. Generic
 *   errors are not declared: the open `default` error covers them and they stay undefined.
 * - `responseBodyHint: 'file'` on the `openapi(...)` meta of binary-only operations.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { apiJobs, orpcErrorMaps, orpcFileResponseOperations } from '../openapi-ts.api.config.ts'

const contractsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

type ContractRoute = { operationId: string; options: ts.ObjectLiteralExpression }

/** The `openapi({ operationId, ... })` meta of a `oc.meta(openapi(...))...` contract chain. */
const contractRoute = (expression: ts.Expression): ContractRoute | undefined => {
  let current: ts.Node = expression
  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    const meta = current.arguments[0]
    if (
      current.expression.name.text === 'meta' &&
      meta &&
      ts.isCallExpression(meta) &&
      ts.isIdentifier(meta.expression) &&
      meta.expression.text === 'openapi'
    ) {
      const options = meta.arguments[0]
      if (!options || !ts.isObjectLiteralExpression(options)) return undefined
      for (const property of options.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === 'operationId' &&
          ts.isStringLiteral(property.initializer)
        )
          return { operationId: property.initializer.text, options }
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
  const props = entries.map(({ code, schemaName }) => {
    const zodName = resolveZodName(schemaName)
    used.add(zodName)
    return `${JSON.stringify(code)}: { data: ${zodName} }`
  })
  return `.errors({ ${props.join(', ')} })`
}

const patchContractFile = (
  directory: string,
  errorMaps: Map<string, OrpcErrorEntry[]>,
  fileResponseOperations: Set<string>,
): number => {
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
      const route = contractRoute(declaration.initializer)
      if (!route) continue
      if (fileResponseOperations.has(route.operationId))
        insertions.push({ at: route.options.getStart() + 1, text: " responseBodyHint: 'file'," })
      const entries = errorMaps.get(route.operationId)
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

let patched = 0
for (const job of apiJobs) {
  if (job.plugins) continue // the console entry job writes loaders, not contracts
  patched += patchContractFile(
    path.join(contractsDir, job.outputPath),
    orpcErrorMaps(job.document),
    orpcFileResponseOperations(job.document),
  )
}
process.stdout.write(`patched ${patched} contracts\n`)
