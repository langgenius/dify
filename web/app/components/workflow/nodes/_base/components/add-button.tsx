'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiAddLine,
} from '@remixicon/react'
import * as React from 'react'
import { Button } from '@/app/components/base/ui/button'

type Props = {
  className?: string
  text: string
  onClick: () => void
}

const AddButton: FC<Props> = ({
  className,
  text,
  onClick,
}) => {
  return (
    <Button
      className={cn('w-full', className)}
      variant="tertiary"
      size="medium"
      onClick={onClick}
    >
      <RiAddLine className="mr-1 h-3.5 w-3.5" />
      <div>{text}</div>
    </Button>
  )
}
export default React.memo(AddButton)
