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
        'flex items-center p-1 gap-0.5 rounded-lg bg-components-input-bg-normal hover:bg-components-input-bg-hover cursor-pointer', open && 'bg-components-input-bg-hover',
        className,
      )}
    >
      <div className='grow flex items-center'>
        <div className='mr-1.5 flex items-center justify-center w-4 h-4 rounded-[5px] border border-dashed border-divider-regular'>
          <CubeOutline className='w-3 h-3 text-text-quaternary' />
        </div>
        <div
          className='text-[13px] text-text-tertiary truncate'
          title='Configure model'
        >
          {t('plugin.detailPanel.configureModel')}
        </div>
      </div>
      <div className='shrink-0 flex items-center justify-center w-4 h-4'>
        <RiEqualizer2Line className='w-3.5 h-3.5 text-text-tertiary' />
      </div>
    </div>
  )
}

export default ModelTrigger
