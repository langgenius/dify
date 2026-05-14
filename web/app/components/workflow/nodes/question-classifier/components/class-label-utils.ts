'use client'
import type { TFunction } from 'i18next'

const i18nPrefix = 'nodes.questionClassifiers'
const LEGACY_DEFAULT_LABEL_PREFIX = 'CLASS'
const DEFAULT_EQUIVALENT_PREFIXES = ['CLASS', '分类', '分類', 'クラス']

const getCanonicalDefaultClassLabel = (index: number) => `${LEGACY_DEFAULT_LABEL_PREFIX} ${index}`

const getTranslatedDefaultClassLabel = (t: TFunction, index: number) => {
  const translated = t(`${i18nPrefix}.defaultLabel`, { ns: 'workflow', index })
  if (typeof translated !== 'string')
    return undefined

  const resolvedLabel = translated.replace('{{index}}', String(index))
  const rawWorkflowKey = `workflow.${i18nPrefix}.defaultLabel`
  const rawKey = `${i18nPrefix}.defaultLabel`
  if (
    resolvedLabel === rawWorkflowKey
    || resolvedLabel === rawKey
    || resolvedLabel.startsWith(`${rawWorkflowKey}:`)
    || resolvedLabel.startsWith(`${rawKey}:`)
  ) {
    return undefined
  }

  return resolvedLabel
}

const normalizeClassLabel = (label?: string | null) => label?.trim() ?? ''

export const getDefaultClassLabel = (_t: TFunction, index: number) => getCanonicalDefaultClassLabel(index)

export const getDisplayClassLabel = (
  label: string | undefined,
  index: number,
  t: TFunction,
) => normalizeClassLabel(label) || getTranslatedDefaultClassLabel(t, index) || getCanonicalDefaultClassLabel(index)

export const isDefaultClassLabel = (
  label: string | undefined,
  index: number,
  t: TFunction,
) => {
  const normalizedLabel = normalizeClassLabel(label)
  if (!normalizedLabel)
    return true

  return DEFAULT_EQUIVALENT_PREFIXES.some(prefix => normalizedLabel === `${prefix} ${index}`)
    || normalizedLabel === getTranslatedDefaultClassLabel(t, index)
}

export const getCanonicalClassLabel = (
  label: string | undefined,
  index: number,
  t: TFunction,
) => {
  const normalizedLabel = normalizeClassLabel(label)
  if (!normalizedLabel)
    return getCanonicalDefaultClassLabel(index)

  if (isDefaultClassLabel(normalizedLabel, index, t))
    return getCanonicalDefaultClassLabel(index)

  return normalizedLabel
}
