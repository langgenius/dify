export const DEFAULT_TABS_WIDTH = 320
export const ENVIRONMENT_TAB_MAX_WIDTH = 88
export const ENVIRONMENT_TAB_HORIZONTAL_PADDING = 16
export const ENVIRONMENT_TAB_LABEL_MAX_WIDTH =
  ENVIRONMENT_TAB_MAX_WIDTH - ENVIRONMENT_TAB_HORIZONTAL_PADDING
export const SELECTED_OVERFLOW_LABEL_MAX_WIDTH = ENVIRONMENT_TAB_LABEL_MAX_WIDTH - 16
export const TAB_GAP = 4

type EnvironmentTabLayout = {
  overflowEnvironmentIds: string[]
  showMore: boolean
  visibleEnvironmentIds: string[]
}

type GetEnvironmentTabLayoutParams = {
  availableWidth: number
  builtInWidth: number
  environmentTabWidths: Record<string, number>
  hasUndeployedEnvironments: boolean
  joinedEnvironmentIds: readonly string[]
  moreEnvironmentsWidth: number
  moreWidth: number
}

// Used only for SSR, the first render, or when browser layout measurements are unavailable.
// Once mounted, the hidden measurement elements provide the rendered widths with actual styles.
export function estimateFallbackTextWidth(value: string) {
  return Array.from(value).reduce((width, character) => {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint > 0x2e7f) return width + 13
    if (character === ' ') return width + 4
    return width + 6.5
  }, 0)
}

export function estimateFallbackTabWidth(value: string) {
  return Math.min(
    ENVIRONMENT_TAB_MAX_WIDTH,
    estimateFallbackTextWidth(value) + ENVIRONMENT_TAB_HORIZONTAL_PADDING,
  )
}

function rowWidth(widths: readonly number[]) {
  if (widths.length === 0) return 0
  return widths.reduce((total, width) => total + width, 0) + (widths.length - 1) * TAB_GAP
}

export function getEnvironmentTabLayout({
  availableWidth,
  builtInWidth,
  environmentTabWidths,
  hasUndeployedEnvironments,
  joinedEnvironmentIds,
  moreEnvironmentsWidth,
  moreWidth,
}: GetEnvironmentTabLayoutParams): EnvironmentTabLayout {
  const joinedWidths = joinedEnvironmentIds.map(
    (environmentId) => environmentTabWidths[environmentId] ?? ENVIRONMENT_TAB_MAX_WIDTH,
  )
  const allTabsFit =
    !hasUndeployedEnvironments && rowWidth([builtInWidth, ...joinedWidths]) <= availableWidth

  if (allTabsFit) {
    return {
      overflowEnvironmentIds: [],
      showMore: false,
      visibleEnvironmentIds: [...joinedEnvironmentIds],
    }
  }

  const showMore = hasUndeployedEnvironments || joinedEnvironmentIds.length > 0
  if (!showMore) {
    return {
      overflowEnvironmentIds: [],
      showMore: false,
      visibleEnvironmentIds: [],
    }
  }

  const triggerWidth =
    joinedEnvironmentIds.length === 0
      ? moreEnvironmentsWidth
      : Math.max(moreWidth, ENVIRONMENT_TAB_MAX_WIDTH)
  const visibleEnvironmentIds: string[] = []
  let visibleTabsWidth = builtInWidth

  for (const environmentId of joinedEnvironmentIds) {
    const environmentWidth = environmentTabWidths[environmentId] ?? ENVIRONMENT_TAB_MAX_WIDTH
    const nextVisibleTabsWidth = visibleTabsWidth + TAB_GAP + environmentWidth
    const widthWithTrigger = nextVisibleTabsWidth + TAB_GAP + triggerWidth

    if (widthWithTrigger > availableWidth) break

    visibleEnvironmentIds.push(environmentId)
    visibleTabsWidth = nextVisibleTabsWidth
  }

  return {
    overflowEnvironmentIds: joinedEnvironmentIds.slice(visibleEnvironmentIds.length),
    showMore: true,
    visibleEnvironmentIds,
  }
}
