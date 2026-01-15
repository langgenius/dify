'use client'

import type { NodeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import * as React from 'react'
import { useEffect, useRef } from 'react'

type TreeEditInputProps = {
  node: NodeApi<TreeNodeData>
}

const TreeEditInput: React.FC<TreeEditInputProps> = ({ node }) => {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      node.reset()
    }
    else if (e.key === 'Enter') {
      e.preventDefault()
      node.submit(inputRef.current?.value || '')
    }
  }

  const handleBlur = () => {
    node.reset()
  }

  return (
    <input
      ref={inputRef}
      type="text"
      defaultValue={node.data.name}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onClick={e => e.stopPropagation()}
      className="min-w-0 flex-1 rounded border border-components-input-border-active bg-transparent px-1 text-[13px] font-normal leading-4 text-text-primary outline-none"
    />
  )
}

export default React.memo(TreeEditInput)
