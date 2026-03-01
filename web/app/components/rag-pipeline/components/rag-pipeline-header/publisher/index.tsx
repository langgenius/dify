import { RiArrowDownSLine } from '@remixicon/react'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks'
import Popup from './popup'

const Publisher = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()

  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (newOpen)
      handleSyncWorkflowDraft(true)
    setOpen(newOpen)
  }, [handleSyncWorkflowDraft])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      offset={{
        mainAxis: 4,
        crossAxis: 40,
      }}
    >
      <PortalToFollowElemTrigger onClick={() => handleOpenChange(!open)}>
        <Button
          className="px-2"
          variant="primary"
        >
          <span className="pl-1">{t('common.publish', { ns: 'workflow' })}</span>
          <RiArrowDownSLine className="h-4 w-4" />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[11]">
        <Popup />
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(Publisher)
