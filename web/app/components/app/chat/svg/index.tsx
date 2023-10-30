import React from 'react'
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
    <div
      className={'box-border p-0.5 flex items-center justify-center rounded-md bg-white cursor-pointer'}
      onClick={() => { setIsSVG(prevIsSVG => !prevIsSVG) }}
    >
      <div className={`w-6 h-6 rounded-md hover:bg-gray-50 ${s.svgIcon} ${isSVG ? s.svgIconed : ''}`}></div>
    </div>
  )
}

export default SVGBtn
