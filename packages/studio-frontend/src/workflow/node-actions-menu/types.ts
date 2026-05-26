import type { Node } from '../types'

export type NodeActionsMenuProps = {
  id: string
  data: Node['data']
  onClose: () => void
  showHelpLink?: boolean
}
