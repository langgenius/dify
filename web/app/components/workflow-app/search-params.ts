import { parseAsStringEnum } from 'nuqs'
import { ViewType } from '@/app/components/workflow/types'

export const parseAsViewType = parseAsStringEnum<ViewType>(Object.values(ViewType))
  .withDefault(ViewType.graph)
  .withOptions({
    history: 'push',
    clearOnDefault: true,
  })

export const WORKFLOW_VIEW_PARAM_KEY = 'view'
