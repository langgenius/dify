'use client'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { formatDocumentTitle, getApplicationTitle } from '@/utils/document-title'

export default function useDocumentTitle(title: string | null) {
  const { data } = useSuspenseQuery(systemFeaturesQueryOptions())
  const branding = data.branding
  const titleStr = title === null ? null : formatDocumentTitle(title, getApplicationTitle(branding))
  useEffect(() => {
    if (titleStr !== null) document.title = titleStr
  }, [titleStr])
}
