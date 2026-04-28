import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RiArrowDownSLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks'
import Popup from './popup'

const Publisher = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [confirmVisible, { setFalse: hideConfirm, setTrue: showConfirm }] = useBoolean(false)
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()

  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (!newOpen && confirmVisible)
      return
    if (newOpen)
      handleSyncWorkflowDraft(true)
    setOpen(newOpen)
  }, [confirmVisible, handleSyncWorkflowDraft])
  const closePopover = useCallback(() => {
    setOpen(false)
  }, [])

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
    >
      <PopoverTrigger
        nativeButton
        render={(
          <Button
            className="px-2"
            variant="primary"
          >
            <span className="pl-1">{t('common.publish', { ns: 'workflow' })}</span>
            <RiArrowDownSLine className="h-4 w-4" />
          </Button>
        )}
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        alignOffset={40}
        popupClassName={cn('border-none bg-transparent shadow-none', confirmVisible && 'hidden')}
      >
        <Popup
          onRequestClose={closePopover}
          confirmVisible={confirmVisible}
          onShowConfirm={showConfirm}
          onHideConfirm={hideConfirm}
        />
      </PopoverContent>
    </Popover>
  )
}

export default memo(Publisher)
