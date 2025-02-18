import type { FC } from 'react'
import { RiEqualizer2Line } from '@remixicon/react'
import { CubeOutline } from '@/app/components/base/icons/src/vender/line/shapes'
import cn from '@/utils/classnames'
import { useTranslation } from 'react-i18next'
type ModelTriggerProps = {
  open: boolean
  className?: string
}
const ModelTrigger: FC<ModelTriggerProps> = ({
  open,
  className,
}) => {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'bg-components-input-bg-normal hover:bg-components-input-bg-hover flex cursor-pointer items-center gap-0.5 rounded-lg p-1', open && 'bg-components-input-bg-hover',
        className,
      )}
    >
      <div className='flex grow items-center'>
        <div className='border-divider-regular mr-1.5 flex h-4 w-4 items-center justify-center rounded-[5px] border border-dashed'>
          <CubeOutline className='text-text-quaternary h-3 w-3' />
        </div>
        <div
          className='text-text-tertiary truncate text-[13px]'
          title='Configure model'
        >
          {t('plugin.detailPanel.configureModel')}
        </div>
      </div>
      <div className='flex h-4 w-4 shrink-0 items-center justify-center'>
        <RiEqualizer2Line className='text-text-tertiary h-3.5 w-3.5' />
      </div>
    </div>
  )
}

export default ModelTrigger
