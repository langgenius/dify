'use client'
import type { FC } from 'react'
import React from 'react'
import s from '@edition/sub/sub-c.module.css'
import cn from '@/utils/classnames'

const Test: FC = () => {
  return (
    <>
      <div className={cn(s.bgImg, 'pl-4')}>SaaS</div>
      <div className={cn(s.bgCopied, 'pl-4')}>Copied</div>
      <div className={cn(s.bgCopied2, 'pl-4')}>Import svg use alias</div>
    </>
  )
}
export default React.memo(Test)
