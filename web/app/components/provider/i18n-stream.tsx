'use client'

import type { Resource } from 'i18next'
import { use, useEffect, useState } from 'react'
import { I18nContext } from 'react-i18next'
import {
  createResourceCollector,
  serializeResourceUpdate,
  subscribeToStreamedResources,
} from '@/i18n/streamed-resources'
import { useServerInsertedHTML } from '@/next/navigation'

export function I18nResourceStream({
  id,
  initial,
  nonce,
}: {
  id: string
  initial: Resource
  nonce?: string
}) {
  const { i18n } = use(I18nContext)
  const [collect] = useState(() => createResourceCollector(i18n, initial))
  useServerInsertedHTML(() => {
    const resources = collect()
    if (Object.keys(resources).length === 0) return null
    return (
      <script
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: serializeResourceUpdate(id, resources) }}
      />
    )
  })
  useEffect(() => subscribeToStreamedResources(id, i18n), [id, i18n])
  return null
}
