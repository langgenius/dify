import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { ChevronDownDouble } from '@/app/components/base/icons/src/vender/line/arrows'

const PriorityUseTip = () => {
  const { t } = useTranslation()

  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <div className="absolute -top-[5px] -right-[5px] cursor-pointer rounded-[5px] border-[0.5px] border-components-panel-border-subtle bg-util-colors-indigo-indigo-50 shadow-xs">
            <ChevronDownDouble className="h-3 w-3 rotate-180 text-util-colors-indigo-indigo-600" />
          </div>
        )}
      />
      <TooltipContent>
        {t('modelProvider.priorityUsing', { ns: 'common' }) || ''}
      </TooltipContent>
    </Tooltip>
  )
}

export default PriorityUseTip
