import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getTypedEventStreamOperations,
  toKebabCase,
  topLevelPathSegment,
} from './api-contract-streaming-utils.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const specs = [
  { name: 'console', segmented: true },
  { name: 'web', segmented: false },
  { name: 'service', segmented: false },
  { name: 'openapi', segmented: false },
]

for (const spec of specs) {
  const document = JSON.parse(
    await readFile(join(packageRoot, 'openapi', `${spec.name}-openapi.json`), 'utf8'),
  )
  const operationsByOutput = new Map()
  for (const operation of getTypedEventStreamOperations(document)) {
    const outputPath = spec.segmented
      ? join(
          packageRoot,
          'generated/api/console',
          toKebabCase(topLevelPathSegment(operation.path)),
          'orpc.gen.ts',
        )
      : join(packageRoot, 'generated/api', spec.name, 'orpc.gen.ts')
    operationsByOutput.set(outputPath, [...(operationsByOutput.get(outputPath) ?? []), operation])
  }

  for (const [outputPath, operations] of operationsByOutput) {
    let source = await readFile(outputPath, 'utf8')
    source = replaceOnce(
      source,
      "import { oc } from '@orpc/contract'",
      "import { eventIterator, oc } from '@orpc/contract'",
    )

    for (const operation of operations) {
      const responseSchema = `z${capitalize(operation.operationId)}Response`
      source = replaceOnce(
        source,
        `.output(${responseSchema})`,
        `.output(eventIterator(${responseSchema}))`,
      )
    }

    await writeFile(outputPath, source)
  }
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function replaceOnce(source, target, replacement) {
  const firstIndex = source.indexOf(target)
  if (firstIndex === -1 || source.indexOf(target, firstIndex + target.length) !== -1)
    throw new Error(`Expected exactly one generated occurrence of ${target}`)

  return source.slice(0, firstIndex) + replacement + source.slice(firstIndex + target.length)
}
