'use client'
import type { FC } from 'react'
import React from 'react'

import s from './style.module.css'

export type IVarHighlightProps = {
  name: string
  className?: string
}

const VarHighlight: FC<IVarHighlightProps> = ({
  name,
  className = '',
}) => {
  return (
    <div
      key={name}
      className={`${s.item} ${className} mb-2 inline-flex h-5 items-center justify-center rounded-md px-1 text-xs font-medium text-primary-600`}
    >
      <span className='opacity-60'>{'{{'}</span><span>{name}</span><span className='opacity-60'>{'}}'}</span>
    </div>
  )
}

// DEPRECATED: This function is vulnerable to XSS attacks and should not be used
// Use the VarHighlight React component instead
export const varHighlightHTML = ({ name, className = '' }: IVarHighlightProps) => {
  const escapedName = name
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

  const html = `<div class="${s.item} ${className} inline-flex mb-2 items-center justify-center px-1 rounded-md h-5 text-xs font-medium text-primary-600">
  <span class='opacity-60'>{{</span>
  <span>${escapedName}</span>
  <span class='opacity-60'>}}</span>
</div>`
  return html
}

export default React.memo(VarHighlight)
