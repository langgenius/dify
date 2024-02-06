import type { ComponentType } from 'react'
import StartNode from './start/node'
import StartPanel from './start/panel'

export const NodeMap: Record<string, ComponentType> = {
  start: StartNode,
}

export const PanelMap: Record<string, ComponentType> = {
  start: StartPanel,
}
