import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import Tooltip from '../../tooltip'

export type LabelProps = {
  htmlFor: string
  label: string
  isRequired?: boolean
  showOptional?: boolean
  tooltip?: string
  className?: string
}

const Label = ({
  htmlFor,
  label,
  isRequired,
  showOptional,
  tooltip,
  className,
}: LabelProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex h-6 items-center">
      <label
        data-testid="label"
        htmlFor={htmlFor}
        className={cn('system-sm-medium text-text-secondary', className)}
      >
        {label}
      </label>
      {!isRequired && showOptional && <div className="system-xs-regular ml-1 text-text-tertiary">{t('label.optional', { ns: 'common' })}</div>}
      {isRequired && <div className="system-xs-regular ml-1 text-text-destructive-secondary">*</div>}
      {tooltip && (
        <Tooltip
          popupContent={
            <div className="w-[200px]">{tooltip}</div>
          }
          triggerClassName="ml-0.5 w-4 h-4"
          triggerTestId={`${htmlFor}-tooltip`}
        />
      )}
    </div>
  )
}

export default Label
