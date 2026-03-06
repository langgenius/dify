import type { ReactNode } from 'react'
import { useCallback, useMemo } from 'react'
import { cn } from '@/utils/classnames'
import RadioGroupContext from '../../context'
import s from '../../style.module.css'

export type TRadioGroupProps = {
  children?: ReactNode | ReactNode[]
  value?: string | number | boolean
  className?: string
  onChange?: (value: any) => void
}

export default function Group({ children, value, onChange, className = '' }: TRadioGroupProps): React.JSX.Element {
  const onRadioChange = useCallback((value: any) => {
    onChange?.(value)
  }, [onChange])

  const contextValue = useMemo(() => ({
    value,
    onChange: onRadioChange,
  }), [value, onRadioChange])

  return (
    <div className={cn('flex items-center bg-workflow-block-parma-bg text-text-secondary', s.container, className)}>
      <RadioGroupContext.Provider value={contextValue}>
        {children}
      </RadioGroupContext.Provider>
    </div>
  )
}
