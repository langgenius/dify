'use client'
import type { FC } from 'react'
import React from 'react'
import s from '@edition/sub/sub-c.module.css'

const Test: FC = () => {
  return (
    <div className={s.bg}>SaaS</div>
  )
}
export default React.memo(Test)
