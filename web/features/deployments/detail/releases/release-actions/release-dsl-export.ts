import type { Release } from '@dify/contracts/enterprise/types.gen'
import { downloadBlob } from '@/utils/download'
import { fetchReleaseDsl } from './release-dsl'

const YAML_EXTENSION_PATTERN = /\.ya?ml$/i
const INVALID_FILENAME_CHARS_PATTERN = /[\\/:*?"<>|]+/g
const FILENAME_SEPARATOR_PATTERN = /[\s-]+/g

function sanitizeFileNamePart(value?: string) {
  if (!value) return ''

  return value
    .trim()
    .replace(YAML_EXTENSION_PATTERN, '')
    .replace(INVALID_FILENAME_CHARS_PATTERN, '-')
    .replace(FILENAME_SEPARATOR_PATTERN, '-')
    .replace(/^-+|-+$/g, '')
}

function releaseDslFileName({
  release,
  appInstanceName,
}: {
  release: Release
  appInstanceName?: string
}) {
  const projectName = sanitizeFileNamePart(appInstanceName)
  const releaseName = sanitizeFileNamePart(release.displayName) || 'release'
  const baseName = [projectName, releaseName].filter(Boolean).join('-')

  return `${baseName}.yaml`
}

export async function exportReleaseDsl({
  release,
  releaseId,
  appInstanceName,
}: {
  release: Release
  releaseId: string
  appInstanceName?: string
}) {
  const data = new Blob([await fetchReleaseDsl(releaseId)], {
    type: 'application/x-yaml;charset=utf-8',
  })
  downloadBlob({
    data,
    fileName: releaseDslFileName({ release, appInstanceName }),
  })
}
