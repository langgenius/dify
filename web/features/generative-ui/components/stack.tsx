'use client'

import type { ComponentRenderProps } from '@openuidev/react-lang'
import type { z } from 'zod/v4'
import type { StackDefinition } from '../registry/definitions'
import { useIsStreaming } from '@openuidev/react-lang'
import { use, useMemo } from 'react'
import { useTranslation } from '#i18n'
import { validateUIContent } from '../validation'
import { AllowInteractiveContext } from './interaction-context'

/** Validate completed trees before mounting editable forms; streamed nodes can remain partial. */
export function GeneratedStack({
  props,
  renderNode,
}: ComponentRenderProps<z.infer<typeof StackDefinition.props>>) {
  const isStreaming = useIsStreaming()
  const allowInteractive = use(AllowInteractiveContext)
  const { t } = useTranslation(['appDebug'])
  const unavailableText = t(($) => $['generativeUI.unavailable'])
  const children = useMemo(
    () =>
      isStreaming
        ? props.children
        : validateUIContent(props.children, unavailableText, { allowInteractive }).children,
    [allowInteractive, isStreaming, props.children, unavailableText],
  )
  return <div className="flex min-w-0 flex-col gap-4">{renderNode(children)}</div>
}
