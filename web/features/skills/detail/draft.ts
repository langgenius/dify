import type { SkillDetailResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ParsedMarkdownContent } from './markdown/frontmatter'
import { isTextFile } from './files/file-format'
import { findFileByPath } from './files/tree-model'
import {
  defaultSkillBody,
  defaultSkillDescription,
  parseMarkdownContent,
  untitledSkillDisplayName,
} from './markdown/frontmatter'

export function isDefaultSkillBuilderDraft(detail: SkillDetailResponse) {
  const skillMd = findFileByPath(detail.files ?? [], 'SKILL.md')
  const skillMdContent =
    skillMd && isTextFile(skillMd) && skillMd.content ? parseMarkdownContent(skillMd.content) : null
  const description = detail.description.trim()
  const skillMdBody = skillMdContent?.body.trim() ?? ''

  return (
    detail.latest_published_version_id == null &&
    detail.name.startsWith('untitled-skill') &&
    detail.display_name === untitledSkillDisplayName &&
    (description === '' || description === defaultSkillDescription) &&
    (skillMdBody === '' || skillMdBody === defaultSkillBody)
  )
}

export function deriveSkillDetailFromDraftFiles(detail: SkillDetailResponse) {
  const skillMd = findFileByPath(detail.files ?? [], 'SKILL.md')
  if (!skillMd || !isTextFile(skillMd) || !skillMd.content) return detail

  const parsedSkillMd = parseMarkdownContent(skillMd.content)
  const shouldDeriveUntitledSkillName =
    detail.latest_published_version_id == null &&
    !detail.name_manually_edited &&
    detail.name.startsWith('untitled-skill') &&
    detail.display_name === untitledSkillDisplayName
  const derivedDisplayName = shouldDeriveUntitledSkillName
    ? getDraftSkillDisplayName(parsedSkillMd)
    : undefined
  const derivedName = derivedDisplayName
    ? getDraftSkillName(parsedSkillMd, derivedDisplayName)
    : undefined

  return {
    ...detail,
    description: parsedSkillMd.description || detail.description,
    ...(derivedDisplayName ? { display_name: derivedDisplayName } : {}),
    ...(derivedName ? { name: derivedName } : {}),
  }
}

function getDraftSkillDisplayName(parsedSkillMd: ParsedMarkdownContent) {
  if (parsedSkillMd.displayName && parsedSkillMd.displayName !== untitledSkillDisplayName)
    return parsedSkillMd.displayName

  const headingLine = parsedSkillMd.body
    .split('\n')
    .find((line) => line.startsWith('# ') && line.slice(2).trim())
  const heading = headingLine?.slice(2).trim()
  if (!heading || heading === untitledSkillDisplayName) return undefined

  return heading
}

function getDraftSkillName(parsedSkillMd: ParsedMarkdownContent, displayName: string) {
  if (parsedSkillMd.name && !parsedSkillMd.name.startsWith('untitled-skill'))
    return parsedSkillMd.name

  const generatedName = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return generatedName || undefined
}
