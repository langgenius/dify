import { RiArrowDownSLine } from '@remixicon/react'
import {
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

type UserInputVariable = {
  variable: string
}

type UserInputProps = {
  variables?: UserInputVariable[]
  initialExpanded?: boolean
}

const UserInput = ({
  variables = [],
  initialExpanded = true,
}: UserInputProps) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(initialExpanded)

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
        {t('panel.userInputField', { ns: 'workflow' }).toLocaleUpperCase()}
      </div>
      <div className="px-2 pt-1 pb-3">
        {
          expanded && (
            <div className="py-2 text-[13px] text-text-primary">
              {
                variables.map((variable: any) => (
                  <div
                    key={variable.variable}
                    className="mb-2 last-of-type:mb-0"
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
