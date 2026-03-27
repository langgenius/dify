import type { AppAssetTreeView } from '@/types/app-asset'

export type SkillFileMetadata = {
  files?: Record<string, AppAssetTreeView>
}

export const extractFileReferenceIds = (content: string) => {
  const ids = new Set<string>()
  const regex = /§\[file\]\.\[app\]\.\[([a-fA-F0-9-]{36})\]§/g
  let match: RegExpExecArray | null
  match = regex.exec(content)
  while (match !== null) {
    if (match[1])
      ids.add(match[1])
    match = regex.exec(content)
  }
  return ids
}

export const parseSkillFileMetadata = (metadata: unknown): Record<string, unknown> => {
  if (!metadata)
    return {}

  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata) as unknown
      return typeof parsed === 'object' && parsed ? parsed as Record<string, unknown> : {}
    }
    catch {
      return {}
    }
  }

  return typeof metadata === 'object' ? metadata as Record<string, unknown> : {}
}
