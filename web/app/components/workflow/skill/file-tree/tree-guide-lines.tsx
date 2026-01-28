'use client'

import * as React from 'react'
import { useMemo } from 'react'

type TreeGuideLinesProps = {
  level: number
  indentSize?: number
  lineOffset?: number
}

const INDENT_SIZE = 20
const DEFAULT_LINE_OFFSET = 10

const TreeGuideLines = ({
  level,
  indentSize = INDENT_SIZE,
  lineOffset = DEFAULT_LINE_OFFSET,
}: TreeGuideLinesProps) => {
  const guides = useMemo(() => {
    if (level === 0)
      return null

    return Array.from({ length: level }, (_, i) => (
      <div
        key={`guide-${i}`}
        className="absolute bottom-0 top-0 border-l border-divider-subtle"
        style={{ left: `${(i + 1) * indentSize - lineOffset}px` }}
      />
    ))
  }, [level, indentSize, lineOffset])

  return guides
}

export default React.memo(TreeGuideLines)
