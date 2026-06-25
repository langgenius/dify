import { cn } from '@langgenius/dify-ui/cn'

const buildPanelGridColumnCount = 384
const buildPanelGridRowCount = 32

function getBuildPanelGridCellOpacity(row: number, column: number) {
  const seed = Math.sin((row + 1) * 12.9898 + (column + 1) * 78.233) * 43758.5453
  const noise = seed - Math.floor(seed)
  const verticalProgress = row / (buildPanelGridRowCount - 1)
  const densityThreshold = 0.26 + verticalProgress * 0.72
  const horizontalWeight = Math.min(1, column / 160)
  const verticalWeight = (1 - verticalProgress) ** 1.7

  if (noise < densityThreshold)
    return 0

  return Number(Math.min(0.272, (0.032 + noise * 0.058 + horizontalWeight * 0.09) * verticalWeight).toFixed(3))
}

const buildPanelGridCells = Array.from(
  { length: buildPanelGridColumnCount * buildPanelGridRowCount },
  (_, index) => {
    const row = Math.floor(index / buildPanelGridColumnCount)
    const column = index % buildPanelGridColumnCount
    const opacity = getBuildPanelGridCellOpacity(row, column)

    return {
      id: `build-panel-grid-cell-${row}-${column}`,
      column: column + 1,
      opacity,
      row: row + 1,
    }
  },
).filter(cell => cell.opacity > 0)

function AgentBuildPanelGrid({
  className,
}: {
  className?: string
}) {
  return (
    <div className={cn('grid grid-cols-[repeat(384,4px)] grid-rows-[repeat(32,4px)] gap-0.5 opacity-70', className)}>
      {buildPanelGridCells.map(cell => (
        <span
          key={cell.id}
          className="rounded-[1px] bg-[#98A2B2]"
          style={{ gridColumn: `${cell.column}`, gridRow: `${cell.row}`, opacity: cell.opacity }}
        />
      ))}
    </div>
  )
}

export function AgentBuildPanelBackground({
  visible,
}: {
  visible: boolean
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit] opacity-0 transition-opacity duration-150 motion-reduce:transition-none',
        visible && 'opacity-100',
      )}
    >
      <AgentBuildPanelGrid className="absolute top-0 left-0" />
      <AgentBuildPanelGrid className="absolute bottom-0 left-0 origin-center scale-y-[-1]" />
    </div>
  )
}
