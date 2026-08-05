'use client'
import type { FC } from 'react'
import * as React from 'react'
import s from './style.module.css'

type IVarHighlightProps = {
  name: string
  className?: string
}

const VarHighlight: FC<IVarHighlightProps> = ({ name, className = '' }) => {
  return (
    <div
      key={name}
      className={`${s.item} ${className} mb-2 inline-flex h-5 items-center justify-center rounded-md px-1 text-xs font-medium text-primary-600`}
    >
      <span className="opacity-60">{'{{'}</span>
      <span>{name}</span>
      <span className="opacity-60">{'}}'}</span>
    </div>
  )
}
export default React.memo(VarHighlight)
