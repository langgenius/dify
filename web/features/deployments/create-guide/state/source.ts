'use client'

import type { Getter } from 'jotai/vanilla'
import type { WorkflowSourceApp } from './types'
import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithInfiniteQuery, atomWithQuery } from 'jotai-tanstack-query'
import { dslAppName, isWorkflowDsl } from '@/features/deployments/shared/domain/dsl'
import { consoleQuery } from '@/service/client'
import { normalizeAppPagination } from '@/service/use-apps'
import { AppModeEnum } from '@/types/app'
import { dslFileAtom, dslFileReadVersionAtom, effectiveMethodAtom, selectedAppAtom, sourceSearchTextAtom } from './primitives'
import { SOURCE_APPS_PAGE_SIZE } from './utils'

const dslFileContentQueryAtom = atomWithQuery((get) => {
  const file = get(dslFileAtom)
  const fileReadVersion = get(dslFileReadVersionAtom)

  return queryOptions({
    queryKey: [
      'createGuideDslFileContent',
      fileReadVersion,
      file,
      file?.name ?? '',
      file?.size ?? 0,
      file?.lastModified ?? 0,
    ],
    queryFn: async () => file ? await file.text() : '',
    enabled: Boolean(file),
    retry: false,
  })
})

export const dslContentAtom = atom((get) => {
  return get(dslFileContentQueryAtom).data ?? ''
})

export const isReadingDslAtom = atom((get) => {
  const file = get(dslFileAtom)
  const dslFileContentQuery = get(dslFileContentQueryAtom)

  return Boolean(file && (dslFileContentQuery.isLoading || dslFileContentQuery.isFetching))
})

export const dslReadErrorAtom = atom((get) => {
  return Boolean(get(dslFileAtom) && get(dslFileContentQueryAtom).isError)
})

export const dslDefaultAppNameAtom = atom((get) => {
  const dslContent = get(dslContentAtom)

  return dslContent ? dslAppName(dslContent) : ''
})

export const dslUnsupportedModeAtom = atom((get) => {
  const dslContent = get(dslContentAtom)

  return get(effectiveMethodAtom) === 'importDsl'
    && Boolean(dslContent.trim())
    && !get(isReadingDslAtom)
    && !get(dslReadErrorAtom)
    && !isWorkflowDsl(dslContent)
})

export const importDslReadyAtom = atom((get) => {
  return Boolean(get(dslContentAtom).trim())
    && !get(isReadingDslAtom)
    && !get(dslReadErrorAtom)
    && !get(dslUnsupportedModeAtom)
})

export const sourceAppsQueryAtom = atomWithInfiniteQuery((get) => {
  const sourceSearchText = get(sourceSearchTextAtom)

  return consoleQuery.apps.get.infiniteOptions({
    input: pageParam => ({
      query: {
        page: Number(pageParam),
        limit: SOURCE_APPS_PAGE_SIZE,
        name: sourceSearchText,
        mode: AppModeEnum.WORKFLOW,
      },
    }),
    getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : undefined,
    initialPageParam: 1,
    placeholderData: keepPreviousData,
    select: data => ({
      ...data,
      pages: data.pages.map(normalizeAppPagination),
    }),
    enabled: get(effectiveMethodAtom) === 'bindApp',
  })
})

export const effectiveSelectedAppAtom = atom((get) => {
  const selectedApp = get(selectedAppAtom)
  if (selectedApp)
    return selectedApp

  const sourceAppsQuery = get(sourceAppsQueryAtom)
  if (sourceAppsQuery.isPlaceholderData)
    return undefined

  const sourceApps = (sourceAppsQuery.data?.pages.flatMap(page => page.data) ?? []) as WorkflowSourceApp[]

  return sourceApps[0]
})

export function sourceReady(get: Getter) {
  const method = get(effectiveMethodAtom)

  return method === 'importDsl'
    ? get(importDslReadyAtom)
    : Boolean(get(effectiveSelectedAppAtom)?.id)
}
