import {
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine } from '@remixicon/react'

const UserInput = () => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)
  const variables: any = []

  if (!variables.length)
    return null

  return (
    <div
      className={`
        rounded-xl border
        ${!expanded ? 'border-components-panel-border-subtle bg-components-panel-on-panel-item-bg shadow-none' : 'border-transparent bg-white shadow-xs'}
      `}
    >
      <div
        className={`
          flex h-[18px] cursor-pointer items-center px-2 pt-4 text-[13px] font-semibold
          ${!expanded ? 'text-text-accent-secondary' : 'text-text-secondary'}
        `}
        onClick={() => setExpanded(!expanded)}
      >
        <RiArrowDownSLine
          className={`mr-1 h-3 w-3 ${!expanded ? '-rotate-90 text-text-accent' : 'text-text-tertiary'}`}
        />
        {t('workflow.panel.userInputField').toLocaleUpperCase()}
      </div>
      <div className='px-2 pb-3 pt-1'>
        {
          expanded && (
            <div className='py-2 text-[13px] text-text-primary'>
              {
                variables.map((variable: any) => (
                  <div
                    key={variable.variable}
                    className='mb-2 last-of-type:mb-0'
                  >
                  </div>
                ))
              }
            </div>
          )
        }
      </div>
    </div>
  )
}

export default memo(UserInput)
