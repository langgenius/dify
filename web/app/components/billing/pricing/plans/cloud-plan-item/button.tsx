import type { BasicPlan } from '../../../type'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { Plan } from '../../../type'

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
  warningText?: string
}

const Button = ({
  plan,
  isPlanDisabled,
  btnText,
  handleGetPayUrl,
  warningText,
}: ButtonProps) => {
  return (
    <div className="relative">
      <button
        type="button"
        disabled={isPlanDisabled}
        className={cn(
          'flex w-full items-center gap-x-2 py-3 pr-4 pl-5 system-xl-semibold',
          BUTTON_CLASSNAME[plan].btnClassname,
          isPlanDisabled && BUTTON_CLASSNAME[plan].btnDisabledClassname,
          isPlanDisabled && 'cursor-not-allowed',
        )}
        onClick={handleGetPayUrl}
      >
        <span className="grow text-start">{btnText}</span>
        {!isPlanDisabled && <span className="i-ri-arrow-right-line size-5 shrink-0" />}
      </button>
      {warningText && (
        <div className="absolute top-full right-0 left-0 mt-1.5 text-left system-2xs-medium text-text-tertiary">
          {warningText}
        </div>
      )}
    </div>
  )
}

export default React.memo(Button)
