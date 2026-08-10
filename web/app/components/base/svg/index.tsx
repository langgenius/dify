import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import ActionButton from '../action-button'
import s from './style.module.css'

type ISVGBtnProps = {
  isSVG: boolean
  setIsSVG: React.Dispatch<React.SetStateAction<boolean>>
}

const SVGBtn = ({ isSVG, setIsSVG }: ISVGBtnProps) => {
  return (
    <ActionButton
      aria-label="SVG"
      aria-pressed={isSVG}
      onClick={() => {
        setIsSVG((prevIsSVG) => !prevIsSVG)
      }}
    >
      <span aria-hidden="true" className={cn('block size-4', isSVG ? s.svgIconed : s.svgIcon)} />
    </ActionButton>
  )
}

export default SVGBtn
