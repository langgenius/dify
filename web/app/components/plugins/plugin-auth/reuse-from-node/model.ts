import type { Collection } from '@/app/components/tools/types'

export type ReusableNode = {
  id: string
  title: string
  icon?: Collection['icon']
  source: 'workspace' | 'app-user' | 'reuse'
  disabled?: boolean
  connectionExpired?: boolean
}

// Keep the display information when the referenced node disappears from the graph.
export type ReuseFromNodeReference = Pick<ReusableNode, 'id' | 'title' | 'icon'>
