import type { ReactNode } from 'react'
import { memo } from 'react'
import cn from '@/utils/classnames'
import Badge from '@/app/components/base/badge'
import { ArrowShape } from '@/app/components/base/icons/src/vender/knowledge'
import {
  OptionCardEffectBlue,
  OptionCardEffectOrange,
  OptionCardEffectPurple,
} from '@/app/components/base/icons/src/public/knowledge'

const EffectMap = {
  blue: <OptionCardEffectBlue className='absolute left-1 top-1 h-14 w-14 fill-util-colors-indigo-indigo-500 text-util-colors-indigo-indigo-500 opacity-80 blur-[80px]' />,
  orange: <OptionCardEffectOrange className='absolute left-1 top-1 h-14 w-14 opacity-80 blur-[80px]' />,
  purple: <OptionCardEffectPurple className='absolute left-1 top-1 h-14 w-14 opacity-80 blur-[80px]' />,
}
type OptionCardProps = {
  showHighlightBorder?: boolean
  showRadio?: boolean
  radioIsActive?: boolean
  icon?: ReactNode
  title: string
  description?: string
  isRecommended?: boolean
  children?: ReactNode
  showChildren?: boolean
  effectColor?: 'blue' | 'orange' | 'purple'
}
const OptionCard = ({
  showHighlightBorder,
  showRadio,
  radioIsActive,
  icon,
  title,
  description,
  isRecommended,
  children,
  showChildren,
  effectColor = 'blue',
}: OptionCardProps) => {
  return (
    <div className={cn(
      'cursor-pointer rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg',
      showHighlightBorder && 'border-[2px] border-components-option-card-option-selected-border',
    )}>
      <div className='relative flex p-2'>
        {
          showChildren && (
            <ArrowShape className='absolute bottom-[-13px] left-[13px] h-4 w-4 text-components-panel-bg' />
          )
        }
        {
          showChildren && effectColor && EffectMap[effectColor]
        }
        {
          icon && (
            <div className='mr-1 shrink-0 p-[3px]'>
              {icon}
            </div>
          )
        }
        <div className='grow py-1'>
          <div className='flex items-center'>
            <div className='system-sm-medium flex grow items-center text-text-secondary'>
              {title}
              {
                isRecommended && (
                  <Badge>
                    Recommend
                  </Badge>
                )
              }
            </div>
            {
              showRadio && (
                <div className={cn(
                  'ml-2 h-4 w-4 shrink-0 rounded-full border border-components-radio-border bg-components-radio-bg',
                  radioIsActive && 'border-[5px] border-components-radio-border-checked',
                )}>
                </div>
              )
            }
          </div>
          {
            description && (
              <div className='system-xs-regular mt-1 text-text-tertiary'>
                {description}
              </div>
            )
          }
        </div>
      </div>
      {
        children && showChildren && (
          <div className='p-3'>
            {children}
          </div>
        )
      }
    </div>
  )
}

export default memo(OptionCard)
