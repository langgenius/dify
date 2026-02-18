import type { Viewport } from 'reactflow'
import type { NoteNodeType } from '@/app/components/workflow/note-node/types'
import type { Node } from '@/app/components/workflow/types'
import {
  CUSTOM_NODE,
  NODE_WIDTH_X_OFFSET,
  START_INITIAL_POSITION,
} from '@/app/components/workflow/constants'
import { CUSTOM_DATA_SOURCE_EMPTY_NODE } from '@/app/components/workflow/nodes/data-source-empty/constants'
import { CUSTOM_NOTE_NODE } from '@/app/components/workflow/note-node/constants'
import { NoteTheme } from '@/app/components/workflow/note-node/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { generateNewNode } from '@/app/components/workflow/utils'

export const processNodesWithoutDataSource = (nodes: Node[], viewport?: Viewport) => {
  let leftNode
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]

    if (node.data.type === BlockEnum.DataSource) {
      return {
        nodes,
        viewport,
      }
    }

    if (node.type === CUSTOM_NODE && !leftNode)
      leftNode = node

    if (node.type === CUSTOM_NODE && leftNode && node.position.x < leftNode.position.x)
      leftNode = node
  }

  if (leftNode) {
    const startX = leftNode.position.x - NODE_WIDTH_X_OFFSET
    const startY = leftNode.position.y
    const { newNode } = generateNewNode({
      id: 'data-source-empty',
      type: CUSTOM_DATA_SOURCE_EMPTY_NODE,
      data: {
        title: '',
        desc: '',
        type: BlockEnum.DataSourceEmpty,
        width: 240,
        _isTempNode: true,
      },
      position: {
        x: startX,
        y: startY,
      },
    })
    const newNoteNode = generateNewNode({
      id: 'note',
      type: CUSTOM_NOTE_NODE,
      data: {
        title: '',
        desc: '',
        type: '' as any,
        text: '{"root":{"children":[{"children":[{"detail":0,"format":1,"mode":"normal","style":"font-size: 14px;","text":"Get started with a blank pipeline","type":"text","version":1}],"direction":"ltr","format":"","indent":0,"type":"paragraph","version":1,"textFormat":1,"textStyle":"font-size: 14px;"},{"children":[],"direction":"ltr","format":"","indent":0,"type":"paragraph","version":1,"textFormat":1,"textStyle":""},{"children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"A Knowledge Pipeline starts with Data Source as the starting node and ends with the knowledge base node. The general steps are: import documents from the data source → use extractor to extract document content → split and clean content into structured chunks → store in the knowledge base.","type":"text","version":1}],"direction":"ltr","format":"","indent":0,"type":"paragraph","version":1,"textFormat":0,"textStyle":""},{"children":[],"direction":"ltr","format":"","indent":0,"type":"paragraph","version":1,"textFormat":0,"textStyle":""},{"children":[{"children":[{"detail":0,"format":2,"mode":"normal","style":"","text":"Link to documentation","type":"text","version":1}],"direction":"ltr","format":"","indent":0,"type":"link","version":1,"textFormat":2,"rel":"noreferrer","target":"_blank","title":null,"url":"https://dify.ai"}],"direction":"ltr","format":"","indent":0,"type":"paragraph","version":1,"textFormat":2,"textStyle":""},{"children":[],"direction":"ltr","format":"","indent":0,"type":"paragraph","version":1,"textFormat":0,"textStyle":""}],"direction":"ltr","format":"","indent":0,"type":"root","version":1,"textFormat":1,"textStyle":"font-size: 14px;"}}',
        theme: NoteTheme.blue,
        author: '',
        showAuthor: true,
        width: 240,
        height: 300,
        _isTempNode: true,
      } as NoteNodeType,
      position: {
        x: startX,
        y: startY + 100,
      },
    }).newNode
    return {
      nodes: [
        newNode,
        newNoteNode,
        ...nodes,
      ],
      viewport: {
        x: (START_INITIAL_POSITION.x - startX) * (viewport?.zoom || 1),
        y: (START_INITIAL_POSITION.y - startY) * (viewport?.zoom || 1),
        zoom: viewport?.zoom || 1,
      },
    }
  }

  return {
    nodes,
    viewport,
  }
}
