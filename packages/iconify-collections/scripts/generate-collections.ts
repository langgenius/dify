import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { importSvgCollections } from 'iconify-import-svg'

type IconData = {
  body: string
  left?: number
  top?: number
  width?: number
  height?: number
  rotate?: 0 | 1 | 2 | 3
  hFlip?: boolean
  vFlip?: boolean
}

type AliasData = Omit<IconData, 'body'> & {
  parent: string
}

type ImportedCollection = {
  icons?: Record<string, IconData>
  aliases?: Record<string, AliasData>
  width?: number
  height?: number
  lastModified?: number
}

type ImportedCollections = Record<string, ImportedCollection>

type CollectionInfo = {
  prefix: string
  name: string
  total: number
  version: string
  author: {
    name: string
    url: string
  }
  license: {
    title: string
    spdx: string
    url: string
  }
  samples: string[]
  palette: false
}

type PackageJson = {
  version: string
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(__dirname, '..')

const flattenCollections = (collections: ImportedCollections, prefix: string) => {
  const icons: Record<string, IconData> = {}
  const aliases: Record<string, AliasData> = {}
  let lastModified = 0

  for (const [collectionKey, collection] of Object.entries(collections)) {
    const segment = collectionKey.slice(prefix.length + 1)
    const namePrefix = segment ? `${segment}-` : ''

    const applyCollectionSize = <T extends IconData | AliasData>(iconData: T): T => ({
      ...iconData,
      ...(iconData.width === undefined && collection.width !== undefined ? { width: collection.width } : {}),
      ...(iconData.height === undefined && collection.height !== undefined ? { height: collection.height } : {}),
    })

    for (const [iconName, iconData] of Object.entries(collection.icons ?? {}))
      icons[`${namePrefix}${iconName}`] = applyCollectionSize(iconData)

    for (const [aliasName, aliasData] of Object.entries(collection.aliases ?? {}))
      aliases[`${namePrefix}${aliasName}`] = applyCollectionSize(aliasData)

    if (typeof collection.lastModified === 'number')
      lastModified = Math.max(lastModified, collection.lastModified)
  }

  return {
    prefix,
    ...(lastModified ? { lastModified } : {}),
    icons,
    ...(Object.keys(aliases).length ? { aliases } : {}),
  }
}

const customPublicCollections = importSvgCollections({
  source: path.resolve(packageDir, 'assets/public'),
  prefix: 'custom-public',
  ignoreImportErrors: true,
  cleanupSVG: true,
  deOptimisePaths: true,
  runSVGO: true,
  parseColors: false,
}) as ImportedCollections

const customVenderCollections = importSvgCollections({
  source: path.resolve(packageDir, 'assets/vender'),
  prefix: 'custom-vender',
  ignoreImportErrors: true,
  cleanupSVG: true,
  deOptimisePaths: true,
  runSVGO: false,
  parseColors: {
    callback: () => 'currentColor',
  },
}) as ImportedCollections

const createCollectionInfo = (
  prefix: string,
  name: string,
  icons: Record<string, IconData>,
  version: string,
): CollectionInfo => ({
  prefix,
  name,
  total: Object.keys(icons).length,
  version,
  author: {
    name: 'LangGenius, Inc.',
    url: 'https://github.com/langgenius/dify',
  },
  license: {
    title: 'Modified Apache 2.0',
    spdx: 'Apache-2.0',
    url: 'https://github.com/langgenius/dify/blob/main/LICENSE',
  },
  samples: Object.keys(icons).slice(0, 6),
  palette: false,
})

const createIndexMjs = (): string => `import icons from './icons.json' with { type: 'json' }
import info from './info.json' with { type: 'json' }
import metadata from './metadata.json' with { type: 'json' }
import chars from './chars.json' with { type: 'json' }

export { icons, info, metadata, chars }
`

const createIndexJs = (): string => `'use strict'

const icons = require('./icons.json')
const info = require('./info.json')
const metadata = require('./metadata.json')
const chars = require('./chars.json')

module.exports = { icons, info, metadata, chars }
`

const createIndexTypes = (): string => `export interface IconifyJSON {
  prefix: string
  icons: Record<string, IconifyIcon>
  aliases?: Record<string, IconifyAlias>
  width?: number
  height?: number
  lastModified?: number
}

export interface IconifyIcon {
  body: string
  left?: number
  top?: number
  width?: number
  height?: number
  rotate?: 0 | 1 | 2 | 3
  hFlip?: boolean
  vFlip?: boolean
}

export interface IconifyAlias extends Omit<IconifyIcon, 'body'> {
  parent: string
}

export interface IconifyInfo {
  prefix: string
  name: string
  total: number
  version: string
  author?: {
    name: string
    url?: string
  }
  license?: {
    title: string
    spdx?: string
    url?: string
  }
  samples?: string[]
  palette?: boolean
}

export interface IconifyMetaData {
  [key: string]: unknown
}

export interface IconifyChars {
  [key: string]: string
}

export declare const icons: IconifyJSON
export declare const info: IconifyInfo
export declare const metadata: IconifyMetaData
export declare const chars: IconifyChars
`

const writeCollectionPackage = async (
  directoryName: string,
  collection: ReturnType<typeof flattenCollections>,
  name: string,
  version: string,
): Promise<void> => {
  const targetDir = path.resolve(packageDir, directoryName)
  const info = createCollectionInfo(collection.prefix, name, collection.icons, version)

  await mkdir(targetDir, { recursive: true })
  await writeFile(path.resolve(targetDir, 'icons.json'), `${JSON.stringify(collection, null, 2)}\n`)
  await writeFile(path.resolve(targetDir, 'info.json'), `${JSON.stringify(info, null, 2)}\n`)
  await writeFile(path.resolve(targetDir, 'metadata.json'), '{}\n')
  await writeFile(path.resolve(targetDir, 'chars.json'), '{}\n')
  await writeFile(path.resolve(targetDir, 'index.mjs'), `${createIndexMjs()}\n`)
  await writeFile(path.resolve(targetDir, 'index.js'), `${createIndexJs()}\n`)
  await writeFile(path.resolve(targetDir, 'index.d.ts'), `${createIndexTypes()}\n`)
}

async function main(): Promise<void> {
  const packageJson = JSON.parse(
    await readFile(path.resolve(packageDir, 'package.json'), 'utf8'),
  ) as PackageJson
  const customPublicCollection = flattenCollections(customPublicCollections, 'custom-public')
  const customVenderCollection = flattenCollections(customVenderCollections, 'custom-vender')

  await rm(path.resolve(packageDir, 'src'), { recursive: true, force: true })
  await rm(path.resolve(packageDir, 'custom-public'), { recursive: true, force: true })
  await rm(path.resolve(packageDir, 'custom-vender'), { recursive: true, force: true })

  await writeCollectionPackage(
    'custom-public',
    customPublicCollection,
    'Dify Custom Public',
    packageJson.version,
  )
  await writeCollectionPackage(
    'custom-vender',
    customVenderCollection,
    'Dify Custom Vender',
    packageJson.version,
  )
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
