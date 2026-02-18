import * as React from 'react'
import { cn } from '@/utils/classnames'
import ActionButton from '../action-button'
import s from './style.module.css'

type ISVGBtnProps = {
  isSVG: boolean
  setIsSVG: React.Dispatch<React.SetStateAction<boolean>>
}

const SVGBtn = ({
  isSVG,
  setIsSVG,
}: ISVGBtnProps) => {
  return (
    <ActionButton onClick={() => { setIsSVG(prevIsSVG => !prevIsSVG) }}>
      <div className={cn('h-4 w-4', isSVG ? s.svgIconed : s.svgIcon)}></div>
    </ActionButton>
  )
}

export default SVGBtn
