import React from 'react'
import s from './style.module.css'
import ActionButton from '../action-button'
import cn from '@/utils/classnames'

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
      <div className={cn('w-4 h-4', isSVG ? s.svgIconed : s.svgIcon)}></div>
    </ActionButton>
  )
}

export default SVGBtn
