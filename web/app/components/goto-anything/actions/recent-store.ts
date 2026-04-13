const RECENT_ITEMS_KEY = 'goto-anything:recent'
const MAX_RECENT_ITEMS = 8

export type RecentItem = {
  id: string
  title: string
  description?: string
  path: string
  originalType: 'app' | 'knowledge'
}

export const addRecentItem = (item: RecentItem): void => {
  try {
    const recent = getRecentItems()
    const filtered = recent.filter(r => r.id !== item.id)
    const updated = [item, ...filtered].slice(0, MAX_RECENT_ITEMS)
    localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(updated))
  }
  catch {}
}

export const getRecentItems = (): RecentItem[] => {
  try {
    const stored = localStorage.getItem(RECENT_ITEMS_KEY)
    return stored ? (JSON.parse(stored) as RecentItem[]) : []
  }
  catch {
    return []
  }
}
