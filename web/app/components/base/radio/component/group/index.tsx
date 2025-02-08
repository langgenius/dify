import type { ReactNode } from 'react'
import RadioGroupContext from '../../context'
import s from '../../style.module.css'
import cn from '@/utils/classnames'

export type TRadioGroupProps = {
  children?: ReactNode | ReactNode[]
  value?: string | number
  className?: string
  onChange?: (value: any) => void
}

export default function Group({ children, value, onChange, className = '' }: TRadioGroupProps): React.JSX.Element {
  const onRadioChange = (value: any) => {
    onChange?.(value)
  }
  return (
    <div className={cn('flex items-center bg-gray-50', s.container, className)}>
      <RadioGroupContext.Provider value={{ value, onChange: onRadioChange }}>
        {children}
      </RadioGroupContext.Provider>
    </div>
  )
}
