import { parseAsStringLiteral } from 'nuqs'
import { ViewType } from '@/app/components/workflow/types'

const VIEW_TYPES = Object.values(ViewType)

export const parseAsViewType = parseAsStringLiteral(VIEW_TYPES)
  .withDefault(ViewType.graph)
  .withOptions({
    history: 'push',
    clearOnDefault: true,
  })

export const WORKFLOW_VIEW_PARAM_KEY = 'view'
