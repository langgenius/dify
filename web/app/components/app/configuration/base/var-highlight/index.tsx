'use client'
import React, { FC } from 'react'

import s from './style.module.css'

export interface IVarHighlightProps {
  name: string
}

const VarHighlight: FC<IVarHighlightProps> = ({
  name,
}) => {
  return (
    <div
      key={name}
      className={`${s.item} flex mb-2 items-center justify-center rounded-md px-1 h-5 text-xs font-medium text-primary-600`}
    >
      <span className='opacity-60'>{'{{'}</span>
      <span>{name}</span>
      <span className='opacity-60'>{'}}'}</span>
    </div>
  )
}

export const varHighlightHTML = ({ name }: IVarHighlightProps) => {
  const html = `<div class="${s.item} inline-flex mb-2 items-center justify-center px-1 rounded-md h-5 text-xs font-medium text-primary-600">
  <span class='opacity-60'>{{</span>
  <span>${name}</span>
  <span class='opacity-60'>}}</span>
</div>`
  return html
}



export default React.memo(VarHighlight)
