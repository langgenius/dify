import { parseAsStringLiteral } from 'nuqs'
import { createQueryGroup } from 'nuqs-jotai'

export const OVERVIEW_WINDOWS = ['24h', '7d', '30d'] as const
export const overviewQueryGroup = createQueryGroup(
  {
    window: parseAsStringLiteral(OVERVIEW_WINDOWS)
      .withDefault('24h')
      .withOptions({ history: 'push' }),
  },
  { debugLabel: 'overview.location' },
)
