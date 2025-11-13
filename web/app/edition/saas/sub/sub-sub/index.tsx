'use client'
import type { FC } from 'react'
import React from 'react'
import s from '../sub-c.module.css'

const SubSub: FC = () => {
  return (
    <div className={s.bg}>
      Sub Sub
    </div>
  )
}
export default React.memo(SubSub)
