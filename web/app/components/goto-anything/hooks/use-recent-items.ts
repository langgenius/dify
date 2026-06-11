'use client'

import { useCallback } from 'react'
import { useLocalStorage } from '@/hooks/use-local-storage'

const RECENT_ITEMS_KEY = 'goto-anything:recent'
const MAX_RECENT_ITEMS = 8

export type RecentItem = {
  id: string
  title: string
  description?: string
  path: string
  originalType: 'app' | 'knowledge'
}

const isRecentItem = (value: unknown): value is RecentItem => {
  if (!value || typeof value !== 'object')
    return false

  const item = value as Partial<RecentItem>
  return typeof item.id === 'string'
    && typeof item.title === 'string'
    && typeof item.path === 'string'
    && (item.description === undefined || typeof item.description === 'string')
    && (item.originalType === 'app' || item.originalType === 'knowledge')
}

const parseRecentItems = (value: string): RecentItem[] => {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed))
      return []

    return parsed.filter(isRecentItem)
  }
  catch {
    return []
  }
}

export const getNextRecentItems = (
  item: RecentItem,
  recentItems: RecentItem[],
) => {
  const filtered = recentItems.filter(recentItem => recentItem.id !== item.id)
  return [item, ...filtered].slice(0, MAX_RECENT_ITEMS)
}

export const useRecentItems = () => {
  const [recentItems, setRecentItems] = useLocalStorage<RecentItem[]>(
    RECENT_ITEMS_KEY,
    [],
    {
      serializer: JSON.stringify,
      deserializer: parseRecentItems,
    },
  )

  const addRecentItem = useCallback((item: RecentItem) => {
    setRecentItems(currentRecentItems => getNextRecentItems(item, currentRecentItems ?? []))
  }, [setRecentItems])

  return {
    recentItems,
    addRecentItem,
  }
}
