import { readFile, writeFile } from 'node:fs/promises'
import { mergeResourcesAsInterface } from 'i18next-resources-for-ts'
import { kebabCase } from 'string-ts'
import { format } from 'vite-plus/fmt'
import { namespaces } from '../i18n/resources.ts'

type Translation = string | string[]

const output = new URL('../i18n/resources.generated.d.ts', import.meta.url)

export async function generateResourceTypes(
  resources: Record<string, Record<string, Translation>>,
) {
  const declaration = mergeResourcesAsInterface(
    Object.entries(resources).map(([name, resources]) => ({ name, resources })),
    { optimize: true },
  )
  const source = `// Generated from i18n/locales/en-US/*.json by pnpm i18n:generate-types. Do not edit.\n\n${declaration}`
  const result = await format('resources.generated.d.ts', source, {
    singleQuote: true,
    semi: false,
  })
  if (result.errors.length) throw new Error('Could not format generated i18n types')
  return result.code
}

async function main() {
  const resources: Record<string, Record<string, Translation>> = {}
  for (const namespace of namespaces) {
    const file = new URL(`../i18n/locales/en-US/${kebabCase(namespace)}.json`, import.meta.url)
    const entries: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (
      !entries ||
      typeof entries !== 'object' ||
      Array.isArray(entries) ||
      Object.values(entries).some(
        (value) =>
          typeof value !== 'string' &&
          !(Array.isArray(value) && value.every((item) => typeof item === 'string')),
      )
    ) {
      throw new Error(`${file.pathname} must contain flat string translations or string arrays`)
    }
    resources[namespace] = entries as Record<string, Translation>
  }
  const generated = await generateResourceTypes(resources)
  if (process.argv.includes('--check')) {
    const current = await readFile(output, 'utf8').catch(() => '')
    if (current !== generated) {
      throw new Error(
        'i18n types are stale. Run pnpm --dir web i18n:generate-types and commit the result.',
      )
    }
  } else {
    await writeFile(output, generated)
  }
}

if (import.meta.main) await main()
