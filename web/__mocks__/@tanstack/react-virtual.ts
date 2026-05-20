import { vi } from 'vitest'

const mockVirtualizer = ({
  count,
  estimateSize,
}: {
  count: number
  estimateSize?: (index: number) => number
}) => {
  const getSize = (index: number) => estimateSize?.(index) ?? 0

  return {
    getTotalSize: () => Array.from({ length: count }).reduce<number>((total, _, index) => total + getSize(index), 0),
    getVirtualItems: () => {
      let start = 0

      return Array.from({ length: count }).map((_, index) => {
        const size = getSize(index)
        const virtualItem = {
          end: start + size,
          index,
          key: index,
          size,
          start,
        }

        start += size
        return virtualItem
      })
    },
    measureElement: vi.fn(),
    scrollToIndex: vi.fn(),
  }
}

export { mockVirtualizer as useVirtualizer }
