'use client'
import type { FC } from 'react'
import React from 'react'
import PlanComp from '../plan'

const Billing: FC = () => {
  return (
    <div>
      <PlanComp />
    </div>
  )
}
export default React.memo(Billing)
