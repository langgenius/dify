import type { Node } from '@/app/components/workflow/types'

export type NodeActionsMenuProps = {
  id: string
  data: Node['data']
  onClose: () => void
  showHelpLink?: boolean
}
