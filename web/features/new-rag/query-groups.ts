import { documentDetailQueryGroup } from './documents/detail/state/location'
import { documentsQueryGroup } from './documents/state/inputs'
import { overviewQueryGroup } from './overview/query-state'
import { retrievalQueryGroup } from './retrieval/state/inputs'

export const newRagQueryGroups = [
  overviewQueryGroup,
  documentsQueryGroup,
  documentDetailQueryGroup,
  retrievalQueryGroup,
] as const
