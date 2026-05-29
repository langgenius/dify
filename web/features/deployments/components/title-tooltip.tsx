'use client'

import type { ReactElement, ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'

export function TitleTooltip({
  children,
  content,
}: {
  children: ReactElement
  content?: ReactNode
}) {
  if (!content)
    return children

  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  )
}
