import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const surface = process.argv[2]
if (!['enterprise', 'enterprise-app-deploy'].includes(surface ?? ''))
  throw new Error('Expected enterprise or enterprise-app-deploy')
const { enterpriseDocument } = await import(`../openapi-ts.${surface}.config.ts`)
const { contract } = await import(`../generated/${surface}/orpc.gen.ts`)
const document = structuredClone(enterpriseDocument)
const prefix = surface === 'enterprise' ? ['enterprise'] : ['enterprise', 'appDeploy']
let operations = 0
function visit(node: Record<string, unknown>, members: string[]) {
  const definition = node['~orpc'] as { route: { method: string; path: string } } | undefined
  if (!definition) {
    for (const [key, child] of Object.entries(node))
      visit(child as Record<string, unknown>, [...members, key])
    return
  }
  const { method, path } = definition.route
  const operation = document.paths?.[path]?.[method.toLowerCase()]
  if (!operation)
    throw new Error(`The enterprise spec does not match the generated contract: ${method} ${path}`)
  operation['x-client-path'] = members
  operations++
}
visit(contract, prefix)
const methods = new Set(['get', 'post', 'patch', 'put', 'delete'])
for (const item of Object.values(document.paths ?? {}) as Record<string, unknown>[]) {
  for (const [method, operation] of Object.entries(item)) {
    if (methods.has(method) && !(operation as Record<string, unknown>)['x-client-path'])
      throw new Error(`An enterprise operation has no generated client member: ${method}`)
  }
}
if (!operations) throw new Error('The enterprise contract is empty')
// Export only the schemas reachable from the public Console surface, not unrelated enterprise APIs.
const snapshot: Record<string, unknown> = {
  openapi: document.openapi,
  info: { title: `Dify ${surface} Console`, version: '1' },
  paths: document.paths,
  components: {},
}
const referenced = new Set<string>()
function includeReferences(value: unknown) {
  if (!value || typeof value !== 'object') return
  const ref = (value as { $ref?: string }).$ref
  if (ref && !referenced.has(ref)) {
    if (!ref.startsWith('#/components/')) throw new Error(`Unsupported reference: ${ref}`)
    referenced.add(ref)
    const keys = ref
      .slice(2)
      .split('/')
      .map((key) => key.replaceAll('~1', '/').replaceAll('~0', '~'))
    let source = document
    let target = snapshot
    for (const key of keys.slice(0, -1)) {
      source = source[key]
      target = (target[key] ??= {}) as Record<string, unknown>
    }
    const key = keys.at(-1)!
    if (!source || !(key in source)) throw new Error(`Missing schema: ${ref}`)
    target[key] = source[key]
    includeReferences(source[key])
  }
  for (const child of Object.values(value)) includeReferences(child)
}
includeReferences(snapshot.paths)
writeFileSync(
  resolve(import.meta.dirname, `../generated/${surface}/openapi.gen.json`),
  `${JSON.stringify(snapshot, null, 2)}\n`,
)
