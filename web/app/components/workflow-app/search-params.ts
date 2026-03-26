import { createParser } from 'nuqs'
import { ViewType } from '@/app/components/workflow/types'

const VIEW_TYPES = Object.values(ViewType) as ViewType[]

export const parseAsViewType = createParser<ViewType>({
  parse: (value) => {
    if (value === 'skill')
      return ViewType.file

    return VIEW_TYPES.includes(value as ViewType) ? value as ViewType : null
  },
  serialize: value => value,
})
  .withDefault(ViewType.graph)
  .withOptions({
    history: 'push',
    clearOnDefault: true,
  })

export const WORKFLOW_VIEW_PARAM_KEY = 'view'
