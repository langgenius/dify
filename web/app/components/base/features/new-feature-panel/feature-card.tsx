import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { Switch } from '@langgenius/dify-ui/switch'
import * as React from 'react'

type Props = Readonly<{
  icon: React.ReactNode
  title: React.ReactNode
  tooltip?: React.ReactNode
  value: boolean | undefined
  description?: string
  children?: React.ReactNode
  disabled?: boolean
  onChange?: (state: boolean) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}>

const FeatureCard = ({
  icon,
  title,
  tooltip,
  value,
  description,
  children,
  disabled,
  onChange,
  onMouseEnter,
  onMouseLeave,
}: Props) => {
  const titleId = React.useId()

  return (
    <div
      className="mb-1 rounded-xl border-t-[0.5px] border-l-[0.5px] border-effects-highlight bg-background-section-burn p-3"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <div className="flex grow items-center system-sm-semibold text-text-secondary">
          <span id={titleId}>{title}</span>
          {!!tooltip && (
            <Infotip>
              <InfotipTrigger
                aria-label={typeof tooltip === 'string' ? tooltip : String(title)}
                className="ml-0.5 size-3.5"
              />
              <InfotipContent aria-label={typeof tooltip === 'string' ? tooltip : String(title)}>
                {tooltip}
              </InfotipContent>
            </Infotip>
          )}
        </div>
        <Switch
          aria-labelledby={titleId}
          disabled={disabled}
          className="shrink-0"
          onCheckedChange={(state) => onChange?.(state)}
          checked={value}
        />
      </div>
      {description && (
        <div className="line-clamp-2 min-h-8 system-xs-regular text-text-tertiary">
          {description}
        </div>
      )}
      {children}
    </div>
  )
}

export default FeatureCard
