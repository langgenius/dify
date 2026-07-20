import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const thisDir = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(thisDir, './generated/api/console/apps/orpc.gen.ts')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './zod.gen' || specifier.endsWith('/zod.gen'))
      return nextResolve(`${specifier}.ts`, context)

    return nextResolve(specifier, context)
  },
})

const { agentSandbox, sandbox } = await import(pathToFileURL(sourcePath).href)

assert.ok(agentSandbox.files.get)
assert.ok(agentSandbox.files.read.get)
assert.ok(agentSandbox.files.upload.post)

assert.ok(sandbox.files.get)
assert.ok(sandbox.files.read.get)
assert.ok(sandbox.files.upload.post)
