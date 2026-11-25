import type { TagType } from '@dify/contracts/api/console/tags/types.gen'
import type { PermissionKey } from '@/models/access-control'

export const getTagManagePermissionKey = (type: TagType): PermissionKey => {
  if (type === 'agent') return 'agent.tag.manage'

  if (type === 'app') return 'app.tag.manage'

  if (type === 'snippet') return 'snippets.create_and_modify'

  return 'dataset.tag.manage'
}
