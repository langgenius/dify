import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type IconData = {
  width?: number
  height?: number
}

type IconCollection = {
  icons: Record<string, IconData>
  width?: number
  height?: number
}

type DimensionRule = {
  collection: 'custom-vender'
  icons: string[]
  width: number
  height: number
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(__dirname, '..')

const dimensionRules: DimensionRule[] = [
  {
    collection: 'custom-vender',
    icons: [
      'main-nav-home',
      'main-nav-home-active',
      'main-nav-integrations',
      'main-nav-integrations-active',
      'main-nav-knowledge',
      'main-nav-knowledge-active',
      'main-nav-marketplace',
      'main-nav-marketplace-active',
      'main-nav-studio',
      'main-nav-studio-active',
    ],
    width: 20,
    height: 20,
  },
]

const readCollection = async (collection: DimensionRule['collection']): Promise<IconCollection> => {
  return JSON.parse(
    await readFile(path.resolve(packageDir, collection, 'icons.json'), 'utf8'),
  ) as IconCollection
}

const main = async () => {
  const collections = new Map<string, IconCollection>()
  const failures: string[] = []

  for (const rule of dimensionRules) {
    if (!collections.has(rule.collection))
      collections.set(rule.collection, await readCollection(rule.collection))

    const collection = collections.get(rule.collection)!

    for (const iconName of rule.icons) {
      const icon = collection.icons[iconName]
      const width = icon?.width ?? collection.width ?? 16
      const height = icon?.height ?? collection.height ?? 16

      if (!icon) {
        failures.push(`${rule.collection}:${iconName} is missing`)
        continue
      }

      if (width !== rule.width || height !== rule.height) {
        failures.push(
          `${rule.collection}:${iconName} expected ${rule.width}x${rule.height}, got ${width}x${height}`,
        )
      }
    }
  }

  if (failures.length) {
    console.error('Icon dimension check failed:')
    for (const failure of failures)
      console.error(`- ${failure}`)
    process.exitCode = 1
    return
  }

  console.log('Icon dimension check passed.')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
