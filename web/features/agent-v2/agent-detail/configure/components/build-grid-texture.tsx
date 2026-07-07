import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

const buildGridColumnCount = 384
const buildGridRowCount = 32

function getBuildGridCellOpacity(row: number, column: number) {
  const seed = Math.sin((row + 1) * 12.9898 + (column + 1) * 78.233) * 43758.5453
  const noise = seed - Math.floor(seed)
  const verticalProgress = row / (buildGridRowCount - 1)
  const densityThreshold = 0.26 + verticalProgress * 0.72
  const horizontalWeight = Math.min(1, column / 160)
  const verticalWeight = (1 - verticalProgress) ** 1.7

  if (noise < densityThreshold)
    return 0

  return Number(Math.min(0.272, (0.032 + noise * 0.058 + horizontalWeight * 0.09) * verticalWeight).toFixed(3))
}

const buildGridCells = Array.from(
  { length: buildGridColumnCount * buildGridRowCount },
  (_, index) => {
    const row = Math.floor(index / buildGridColumnCount)
    const column = index % buildGridColumnCount
    const opacity = getBuildGridCellOpacity(row, column)

    return {
      id: `build-grid-cell-${row}-${column}`,
      column: column + 1,
      opacity,
      row: row + 1,
    }
  },
).filter(cell => cell.opacity > 0)

export function AgentBuildGridTexture({
  cellOpacityMultiplier = 1,
  className,
  dotClassName,
  ...props
}: ComponentPropsWithoutRef<'div'> & {
  cellOpacityMultiplier?: number
  dotClassName?: string
}) {
  return (
    <div
      className={cn('grid grid-cols-[repeat(384,4px)] grid-rows-[repeat(32,4px)] gap-0.5 opacity-70', className)}
      {...props}
    >
      {buildGridCells.map(cell => (
        <span
          key={cell.id}
          className={cn('rounded-[1px] bg-[#98A2B2]', dotClassName)}
          style={{ gridColumn: `${cell.column}`, gridRow: `${cell.row}`, opacity: Math.min(1, cell.opacity * cellOpacityMultiplier) }}
        />
      ))}
    </div>
  )
}
