'use client'

import type { UnsupportedDslNode } from '../domain/error'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

function translatedNodeType(type: string | undefined, t: ReturnType<typeof useTranslation>['t']) {
  if (!type)
    return t($ => $['unsupportedDslNodes.unknownType'])

  return t($ => $[`blocks.${type}`], {
    defaultValue: type,
    ns: 'workflow',
  })
}

function unsupportedNodeTypeLabels(nodes: UnsupportedDslNode[], t: ReturnType<typeof useTranslation>['t']) {
  return Array.from(new Set(nodes.map(node => translatedNodeType(node.type, t))))
}

function formattedNodeTypeList(labels: string[], language: string) {
  if (labels.length === 0)
    return ''

  try {
    return new Intl.ListFormat(language, { type: 'conjunction' }).format(labels)
  }
  catch {
    return labels.join(', ')
  }
}

export function UnsupportedDslNodesAlert({ nodes, className }: {
  nodes: UnsupportedDslNode[]
  className?: string
}) {
  const { i18n, t } = useTranslation('deployments')

  if (nodes.length === 0)
    return null

  const nodeTypeLabels = unsupportedNodeTypeLabels(nodes, t)
  const nodeTypes = formattedNodeTypeList(nodeTypeLabels, i18n.language)
  const description = nodeTypes
    ? t($ => $['unsupportedDslNodes.descriptionWithTypes'], { nodeTypes })
    : t($ => $['unsupportedDslNodes.description'])

  return (
    <div
      role="alert"
      className={cn(
        'rounded-lg border border-util-colors-red-red-200 bg-util-colors-red-red-50 p-3',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-0.5 i-ri-error-warning-fill size-4 shrink-0 text-text-destructive" />
        <div className="min-w-0 grow">
          <div className="system-sm-semibold text-text-primary">
            {t($ => $['unsupportedDslNodes.title'])}
          </div>
          <p className="mt-0.5 system-xs-regular text-text-secondary">
            {description}
          </p>
        </div>
      </div>
    </div>
  )
}
