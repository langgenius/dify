import {
  memo,
  useCallback,
  useState,
} from 'react'
import {
  FloatingPortal,
  flip,
  offset,
  shift,
  useFloating,
} from '@floating-ui/react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { useStore } from '../../store'
import Button from '@/app/components/base/button'

type LinkEditorComponentProps = {
  containerElement: HTMLDivElement | null
  linkUrl?: string
  showInput?: boolean
}
const LinkEditorComponent = ({
  containerElement,
  linkUrl,
  showInput = true,
}: LinkEditorComponentProps) => {
  const { t } = useTranslation()
  const [url, setUrl] = useState(linkUrl)
  const anchorElement = useStore(s => s.anchorElement)
  const { refs, floatingStyles, elements } = useFloating({
    placement: 'top',
    middleware: [
      offset(4),
      shift(),
      flip(),
    ],
  })

  const handleConfirm = useCallback(() => {}, [])

  if (!anchorElement)
    return null

  if (!elements.reference && anchorElement)
    refs.setReference(anchorElement)

  return (
    <>
      {
        elements.reference && (
          <FloatingPortal root={containerElement}>
            <div
              className={cn(
                'inline-flex items-center rounded-md border-[0.5px] border-black/5 bg-white z-10',
                showInput && 'p-1 shadow-md',
                !showInput && 'p-0.5 shadow-sm',
              )}
              style={floatingStyles}
              ref={refs.setFloating}
            >
              {
                showInput && (
                  <>
                    <input
                      className='mr-0.5 p-1 w-[196px] h-6 rounded-sm text-[13px]'
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                    />
                    <Button onClick={handleConfirm}>{t('common.operation.ok')}</Button>
                  </>
                )
              }
            </div>
          </FloatingPortal>
        )
      }
    </>
  )
}

export default memo(LinkEditorComponent)
