'use client'

import type { i18n, Resource } from 'i18next'
import { useEffect, useState } from 'react'
import {
  createResourceCollector,
  serializeResourceUpdate,
  subscribeToStreamedResources,
} from '@/i18n/streamed-resources'
import { useServerInsertedHTML } from '@/next/navigation'

export function I18nResourceStream({
  id,
  initial,
  i18n,
  nonce,
}: {
  id: string
  initial: Resource
  i18n: i18n
  nonce?: string
}) {
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
