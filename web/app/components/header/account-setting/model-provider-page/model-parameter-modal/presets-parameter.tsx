import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import Dropdown from '@/app/components/base/dropdown'
import { Brush01 } from '@/app/components/base/icons/src/vender/solid/editor'
import { Scales02 } from '@/app/components/base/icons/src/vender/solid/FinanceAndECommerce'
import { Target04 } from '@/app/components/base/icons/src/vender/solid/general'
import { TONE_LIST } from '@/config'
import cn from '@/utils/classnames'

type PresetsParameterProps = {
  onSelect: (toneId: number) => void
}
const PresetsParameter: FC<PresetsParameterProps> = ({
  onSelect,
}) => {
  const { t } = useTranslation()
  const renderTrigger = useCallback((open: boolean) => {
    return (
      <Button
        size={'small'}
        variant={'secondary'}
        className={cn(open && 'bg-state-base-hover')}
      >
        {t('common.modelProvider.loadPresets')}
        <RiArrowDownSLine className='ml-0.5 h-3.5 w-3.5' />
      </Button>
    )
  }, [t])
  const getToneIcon = (toneId: number) => {
    const className = 'mr-2 w-[14px] h-[14px]'
    const res = ({
      1: <Brush01 className={`${className} text-[#6938EF]`} />,
      2: <Scales02 className={`${className} text-indigo-600`} />,
      3: <Target04 className={`${className} text-[#107569]`} />,
    })[toneId]
    return res
  }
  const options = TONE_LIST.slice(0, 3).map((tone) => {
    return {
      value: tone.id,
      text: (
        <div className='flex h-full items-center'>
          {getToneIcon(tone.id)}
          {t(`common.model.tone.${tone.name}`) as string}
        </div>
      ),
    }
  })

  return (
    <Dropdown
      renderTrigger={renderTrigger}
      items={options}
      onSelect={item => onSelect(item.value as number)}
      popupClassName='z-[1003]'
    />
  )
}

export default PresetsParameter
