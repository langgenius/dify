const RECENT_ITEMS_KEY = 'goto-anything:recent'
const MAX_RECENT_ITEMS = 8

export function getRecentItems() {
  try {
    const stored = localStorage.getItem(RECENT_ITEMS_KEY)
    if (!stored)
      return []
    return JSON.parse(stored) as Array<{
      id: string
      title: string
      description?: string
      path: string
      originalType: 'app' | 'knowledge'
    }>
  }
  catch {
    return []
  }
}

export function addRecentItem(item: ReturnType<typeof getRecentItems>[number]): void {
  try {
    const recent = getRecentItems()
    const filtered = recent.filter(r => r.id !== item.id)
    const updated = [item, ...filtered].slice(0, MAX_RECENT_ITEMS)
    localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(updated))
  }
  catch {}
}
