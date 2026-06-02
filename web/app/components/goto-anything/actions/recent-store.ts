import { useLocalStorage } from '@/hooks/use-local-storage'

const RECENT_ITEMS_KEY = 'goto-anything:recent'
const MAX_RECENT_ITEMS = 8

interface RecentItem {
  id: string
  title: string
  description?: string
  path: string
  originalType: 'app' | 'knowledge'
}

export function getRecentItems(): RecentItem[] {
  try {
    const [stored] = useLocalStorage<string>(RECENT_ITEMS_KEY, '', { raw: true })
    if (!stored || !stored.value) return []
    return JSON.parse(stored.value) as RecentItem[]
  }
  catch {
    return []
  }
}

export function addRecentItem(item: RecentItem): void {
  try {
    const [stored, setStored] = useLocalStorage<string>(RECENT_ITEMS_KEY, '', { raw: true })
    const recent = getRecentItems()
    const filtered = recent.filter(r => r.id !== item.id)
    const updated = [item, ...filtered].slice(0, MAX_RECENT_ITEMS)
    setStored(JSON.stringify(updated))
  }
  catch {}
}