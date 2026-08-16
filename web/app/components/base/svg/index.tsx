import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Toggle } from '@langgenius/dify-ui/toggle'
import * as React from 'react'
import s from './style.module.css'

type ISVGBtnProps = {
  isSVG: boolean
  setIsSVG: React.Dispatch<React.SetStateAction<boolean>>
}

const SVGBtn = ({ isSVG, setIsSVG }: ISVGBtnProps) => {
  return (
    <Toggle
      pressed={isSVG}
      onPressedChange={setIsSVG}
      render={
        <IconButton aria-label="SVG">
          <span
            aria-hidden="true"
            className={cn('block size-4', isSVG ? s.svgIconed : s.svgIcon)}
          />
        </IconButton>
      }
    />
  )
}

export default SVGBtn
