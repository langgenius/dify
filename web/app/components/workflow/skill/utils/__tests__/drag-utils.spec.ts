import type * as React from 'react'
import { INTERNAL_NODE_DRAG_TYPE } from '../../constants'
import {
  getDragActionType,
  isDragEvent,
  isFileDrag,
  isNodeDrag,
} from '../drag-utils'

const createDragEvent = (types: string[]): React.DragEvent => ({
  dataTransfer: {
    types,
  },
} as unknown as React.DragEvent)

describe('drag-utils', () => {
  it('should detect external file drags', () => {
    const event = createDragEvent(['Files'])

    expect(isFileDrag(event)).toBe(true)
    expect(isNodeDrag(event)).toBe(false)
    expect(isDragEvent(event)).toBe(true)
    expect(getDragActionType(event)).toBe('upload')
  })

  it('should detect internal node drags', () => {
    const event = createDragEvent([INTERNAL_NODE_DRAG_TYPE])

    expect(isFileDrag(event)).toBe(false)
    expect(isNodeDrag(event)).toBe(true)
    expect(isDragEvent(event)).toBe(true)
    expect(getDragActionType(event)).toBe('move')
  })

  it('should reject unsupported drag payloads', () => {
    const event = createDragEvent(['text/plain'])

    expect(isDragEvent(event)).toBe(false)
    expect(getDragActionType(event)).toBeNull()
  })
})
