import React from 'react'
import type { BasicPlan } from '../../../type'
import { Plan } from '../../../type'
import cn from '@/utils/classnames'
import { RiArrowRightLine } from '@remixicon/react'

const BUTTON_CLASSNAME = {
  [Plan.sandbox]: {
    btnClassname: 'bg-components-button-tertiary-bg hover:bg-components-button-tertiary-bg-hover text-text-primary',
    btnDisabledClassname: 'bg-components-button-tertiary-bg-disabled hover:bg-components-button-tertiary-bg-disabled text-text-disabled',
  },
  [Plan.professional]: {
    btnClassname: 'bg-saas-dify-blue-static hover:bg-saas-dify-blue-static-hover text-text-primary-on-surface',
    btnDisabledClassname: 'bg-components-button-tertiary-bg-disabled hover:bg-components-button-tertiary-bg-disabled text-text-disabled',
  },
  [Plan.team]: {
    btnClassname: 'bg-saas-background-inverted hover:bg-saas-background-inverted-hover text-background-default',
    btnDisabledClassname: 'bg-components-button-tertiary-bg-disabled hover:bg-components-button-tertiary-bg-disabled text-text-disabled',
  },
}

type ButtonProps = {
  plan: BasicPlan
  isPlanDisabled: boolean
  btnText: string
  handleGetPayUrl: () => void
}

const Button = ({
  plan,
  isPlanDisabled,
  btnText,
  handleGetPayUrl,
}: ButtonProps) => {
  return (
    <button
      type='button'
      disabled={isPlanDisabled}
      className={cn(
        'system-xl-semibold flex items-center gap-x-2 py-3 pl-5 pr-4',
        BUTTON_CLASSNAME[plan].btnClassname,
        isPlanDisabled && BUTTON_CLASSNAME[plan].btnDisabledClassname,
        isPlanDisabled && 'cursor-not-allowed',
      )}
      onClick={handleGetPayUrl}
    >
      <span className='grow text-start'>{btnText}</span>
      {!isPlanDisabled && <RiArrowRightLine className='size-5 shrink-0' />}
    </button>
  )
}

export default React.memo(Button)
