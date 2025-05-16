import {
  memo,
  useCallback,
  useState,
} from 'react'
import {
  RiArrowRightUpLine,
  RiHammerLine,
  RiPlayCircleLine,
  RiTerminalBoxLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import Button from '@/app/components/base/button'
import { useFormatTimeFromNow } from '@/app/components/workflow/hooks'
import Divider from '@/app/components/base/divider'

const PUBLISH_SHORTCUT = ['⌘', '⇧', 'P']

const Popup = () => {
  const { t } = useTranslation()
  const [published, setPublished] = useState(false)
  const publishedAt = useStore(s => s.publishedAt)
  const draftUpdatedAt = useStore(s => s.draftUpdatedAt)
  const { formatTimeFromNow } = useFormatTimeFromNow()

  const handlePublish = useCallback(async () => {
    try {
      setPublished(true)
    }
    catch {
      setPublished(false)
    }
  }, [])

  return (
    <div className='w-[320px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5'>
      <div className='p-4 pt-3'>
        <div className='system-xs-medium-uppercase flex h-6 items-center text-text-tertiary'>
          {publishedAt ? t('workflow.common.latestPublished') : t('workflow.common.currentDraftUnpublished')}
        </div>
        {
          publishedAt
            ? (
              <div className='flex items-center justify-between'>
                <div className='system-sm-medium flex items-center text-text-secondary'>
                  {t('workflow.common.publishedAt')} {formatTimeFromNow(publishedAt)}
                </div>
              </div>
            )
            : (
              <div className='system-sm-medium flex items-center text-text-secondary'>
                {t('workflow.common.autoSaved')} · {Boolean(draftUpdatedAt) && formatTimeFromNow(draftUpdatedAt!)}
              </div>
            )
        }
        <Button
          variant='primary'
          className='mt-3 w-full'
          onClick={() => handlePublish()}
          disabled={published}
        >
          {
            published
              ? t('workflow.common.published')
              : (
                <div className='flex gap-1'>
                  <span>{t('workflow.common.publishUpdate')}</span>
                  <div className='flex gap-0.5'>
                    {PUBLISH_SHORTCUT.map(key => (
                      <span key={key} className='system-kbd h-4 w-4 rounded-[4px] bg-components-kbd-bg-white text-text-primary-on-surface'>
                        {key}
                      </span>
                    ))}
                  </div>
                </div>
              )
          }
        </Button>
      </div>
      <div className='border-t-[0.5px] border-t-divider-regular p-4 pt-3'>
        <Button
          className='mb-1 w-full hover:bg-state-accent-hover hover:text-text-accent'
          variant='tertiary'
        >
          <div className='flex grow items-center'>
            <RiPlayCircleLine className='mr-2 h-4 w-4' />
            {t('pipeline.common.goToAddDocuments')}
          </div>
          <RiArrowRightUpLine className='ml-2 h-4 w-4 shrink-0' />
        </Button>
        <Button
          className='w-full hover:bg-state-accent-hover hover:text-text-accent'
          variant='tertiary'
        >
          <div className='flex grow items-center'>
            <RiTerminalBoxLine className='mr-2 h-4 w-4' />
            {t('workflow.common.accessAPIReference')}
          </div>
          <RiArrowRightUpLine className='ml-2 h-4 w-4 shrink-0' />
        </Button>
        <Divider className='my-2' />
        <Button
          className='w-full hover:bg-state-accent-hover hover:text-text-accent'
          variant='tertiary'
        >
          <div className='flex grow items-center'>
            <RiHammerLine className='mr-2 h-4 w-4' />
            {t('pipeline.common.publishAs')}
          </div>
        </Button>
      </div>
    </div>
  )
}

export default memo(Popup)
