import type { Release } from '@dify/contracts/enterprise/types.gen'
import { get } from '@/service/base'
import { downloadBlob } from '@/utils/download'

const YAML_EXTENSION_PATTERN = /\.ya?ml$/i
const INVALID_FILENAME_CHARS_PATTERN = /[\\/:*?"<>|]+/g
const FILENAME_SEPARATOR_PATTERN = /[\s-]+/g

function sanitizeFileNamePart(value?: string) {
  return value
    ?.trim()
    .replace(YAML_EXTENSION_PATTERN, '')
    .replace(INVALID_FILENAME_CHARS_PATTERN, '-')
    .replace(FILENAME_SEPARATOR_PATTERN, '-')
    .replace(/^-+|-+$/g, '') ?? ''
}

export function releaseDslFileName({ release, appInstanceName }: {
  release: Release
  appInstanceName?: string
}) {
  const projectName = sanitizeFileNamePart(appInstanceName)
  const releaseName = sanitizeFileNamePart(release.name || release.id) || 'release'
  const baseName = [projectName, releaseName].filter(Boolean).join('-')

  return `${baseName}.yaml`
}

export async function exportReleaseDsl({ release, appInstanceName }: {
  release: Release & { id: string }
  appInstanceName?: string
}) {
  const response = await get<Response>(
    `enterprise/app-deploy/releases/${encodeURIComponent(release.id)}/dsl`,
    {},
    { needAllResponseContent: true, silent: true },
  )
  const data = await response.blob()
  downloadBlob({
    data,
    fileName: releaseDslFileName({ release, appInstanceName }),
  })
}
