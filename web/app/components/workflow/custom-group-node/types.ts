import type { BlockEnum } from '../types'

/**
 * Exit port info stored in Group node
 */
export type ExitPortInfo = {
  portNodeId: string
  leafNodeId: string
  sourceHandle: string
  name: string
}

/**
 * Group node data structure
 * node.type = 'custom-group'
 * node.data.type = '' (empty string to bypass backend NodeType validation)
 */
export type CustomGroupNodeData = {
  type: '' // Empty string bypasses backend NodeType validation
  title: string
  desc?: string
  group: {
    groupId: string
    title: string
    memberNodeIds: string[]
    entryNodeIds: string[]
    inputNodeId: string
    exitPorts: ExitPortInfo[]
    collapsed: boolean
  }
  width?: number
  height?: number
  selected?: boolean
  _isTempNode?: boolean
}

/**
 * Group Input node data structure
 * node.type = 'custom-group-input'
 * node.data.type = ''
 */
export type CustomGroupInputNodeData = {
  type: ''
  title: string
  desc?: string
  groupInput: {
    groupId: string
    title: string
  }
  selected?: boolean
  _isTempNode?: boolean
}

/**
 * Exit Port node data structure
 * node.type = 'custom-group-exit-port'
 * node.data.type = ''
 */
export type CustomGroupExitPortNodeData = {
  type: ''
  title: string
  desc?: string
  exitPort: {
    groupId: string
    leafNodeId: string
    sourceHandle: string
    name: string
  }
  selected?: boolean
  _isTempNode?: boolean
}

/**
 * Member node info for display
 */
export type GroupMember = {
  id: string
  type: BlockEnum
  label?: string
}
