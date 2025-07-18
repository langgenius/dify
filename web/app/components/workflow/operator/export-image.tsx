import type { FC } from 'react'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toJpeg, toPng, toSvg } from 'html-to-image'
import { useNodesReadOnly } from '../hooks'
import TipPopup from './tip-popup'
import { RiExportLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import { useStore as useAppStore } from '@/app/components/app/store'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

const ExportImage: FC = () => {
  const { t } = useTranslation()
  const { getNodesReadOnly } = useNodesReadOnly()

  const appDetail = useAppStore(s => s.appDetail)
  const [open, setOpen] = useState(false)

  const handleExportImage = useCallback(async (type: 'png' | 'jpeg' | 'svg') => {
    if (!appDetail)
      return

    if (getNodesReadOnly())
      return

    setOpen(false)
    const flowElement = document.querySelector('.react-flow__viewport') as HTMLElement
    if (!flowElement) return

    try {
      const filter = (node: HTMLElement) => {
        if (node instanceof HTMLImageElement)
          return node.complete && node.naturalHeight !== 0

        return true
      }

      let dataUrl
      switch (type) {
        case 'png':
          dataUrl = await toPng(flowElement, { filter })
          break
        case 'jpeg':
          dataUrl = await toJpeg(flowElement, { filter })
          break
        case 'svg':
          dataUrl = await toSvg(flowElement, { filter })
          break
        default:
          dataUrl = await toPng(flowElement, { filter })
      }

      const link = document.createElement('a')
      link.href = dataUrl
      link.download = `${appDetail.name}.${type}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
    catch (error) {
      console.error('Export image failed:', error)
    }
  }, [getNodesReadOnly, appDetail])

  const handleTrigger = useCallback(() => {
    if (getNodesReadOnly())
      return

    setOpen(v => !v)
  }, [getNodesReadOnly])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="top-start"
      offset={{
        mainAxis: 4,
        crossAxis: -8,
      }}
    >
      <PortalToFollowElemTrigger>
        <TipPopup title={t('workflow.common.exportImage')}>
          <div
            className={cn(
              'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-state-base-hover hover:text-text-secondary',
              `${getNodesReadOnly() && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled'}`,
            )}
            onClick={handleTrigger}
          >
            <RiExportLine className='h-4 w-4' />
          </div>
        </TipPopup>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-10'>
        <div className='min-w-[120px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur text-text-secondary shadow-lg'>
          <div className='p-1'>
            <div
              className='system-md-regular flex h-8 cursor-pointer items-center rounded-lg px-2 hover:bg-state-base-hover'
              onClick={() => handleExportImage('png')}
            >
              {t('workflow.common.exportPNG')}
            </div>
            <div
              className='system-md-regular flex h-8 cursor-pointer items-center rounded-lg px-2 hover:bg-state-base-hover'
              onClick={() => handleExportImage('jpeg')}
            >
              {t('workflow.common.exportJPEG')}
            </div>
            <div
              className='system-md-regular flex h-8 cursor-pointer items-center rounded-lg px-2 hover:bg-state-base-hover'
              onClick={() => handleExportImage('svg')}
            >
              {t('workflow.common.exportSVG')}
            </div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(ExportImage)
