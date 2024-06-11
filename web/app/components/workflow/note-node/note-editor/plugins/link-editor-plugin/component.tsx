import {
  memo,
  useEffect,
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
import { useLink } from './hooks'
import Button from '@/app/components/base/button'
import {
  Edit03,
  LinkBroken01,
  LinkExternal01,
} from '@/app/components/base/icons/src/vender/line/general'

type LinkEditorComponentProps = {
  containerElement: HTMLDivElement | null
}
const LinkEditorComponent = ({
  containerElement,
}: LinkEditorComponentProps) => {
  const { t } = useTranslation()
  const {
    handleSaveLink,
    handleUnlink,
  } = useLink()
  const selectedLinkUrl = useStore(s => s.selectedLinkUrl)
  const linkAnchorElement = useStore(s => s.linkAnchorElement)
  const linkOperatorShow = useStore(s => s.linkOperatorShow)
  const setLinkOperatorShow = useStore(s => s.setLinkOperatorShow)
  const [url, setUrl] = useState(selectedLinkUrl)
  const { refs, floatingStyles, elements } = useFloating({
    placement: 'top',
    middleware: [
      offset(4),
      shift(),
      flip(),
    ],
  })

  useEffect(() => {
    if (linkAnchorElement)
      refs.setReference(linkAnchorElement)
  }, [linkAnchorElement, refs])

  if (!linkAnchorElement)
    return null

  return (
    <>
      {
        elements.reference && (
          <FloatingPortal root={containerElement}>
            <div
              className={cn(
                'inline-flex items-center rounded-md border-[0.5px] border-black/5 bg-white z-10',
                !linkOperatorShow && 'p-1 shadow-md',
                linkOperatorShow && 'p-0.5 shadow-sm text-xs text-gray-500 font-medium',
              )}
              style={floatingStyles}
              ref={refs.setFloating}
            >
              {
                !linkOperatorShow && (
                  <>
                    <input
                      className='mr-0.5 p-1 w-[196px] h-6 rounded-sm text-[13px] appearance-none outline-none'
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                      placeholder='Enter URL...'
                    />
                    <Button
                      type='primary'
                      className={cn(
                        'py-0 px-2 h-6 text-xs',
                        !url && 'cursor-not-allowed',
                      )}
                      disabled={!url}
                      onClick={() => handleSaveLink(url)}
                    >
                      {t('common.operation.ok')}
                    </Button>
                  </>
                )
              }
              {
                linkOperatorShow && (
                  <>
                    <div className='flex items-center mr-4'>
                      <LinkExternal01 className='mr-1 w-3 h-3' />
                      <div className='mr-1'>Open</div>
                      <a
                        href={url}
                        target='_blank'
                        rel='noreferrer'
                        className='text-primary-600'
                      >
                        {url}
                      </a>
                    </div>
                    <div className='mr-1 w-[1px] h-3.5 bg-gray-100'></div>
                    <div
                      className='flex items-center mr-0.5 px-2 h-6 rounded-md cursor-pointer hover:bg-gray-50'
                      onClick={() => setLinkOperatorShow(false)}
                    >
                      <Edit03 className='mr-1 w-3 h-3' />
                      Edit
                    </div>
                    <div
                      className='flex items-center px-2 h-6 rounded-md cursor-pointer hover:bg-gray-50'
                      onClick={handleUnlink}
                    >
                      <LinkBroken01 className='mr-1 w-3 h-3' />
                      Unlink
                    </div>
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
