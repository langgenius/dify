'use client'

import classNames from 'classnames'
import { useTranslation } from 'react-i18next'
import { type AppMode } from '@/types/app'
import style from '../list.module.css'

export type AppModeLabelProps = {
  mode: AppMode
  className?: string
}

const AppModeLabel = ({
  mode,
  className,
}: AppModeLabelProps) => {
  const { t } = useTranslation()
  return (
    <span className={classNames('flex items-center w-fit h-6 gap-1 px-2 text-gray-500 text-xs border border-gray-100 rounded', className)}>
      <span className={classNames(style.listItemFooterIcon, mode === 'chat' && style.solidChatIcon, mode === 'completion' && style.solidCompletionIcon)} />
      {t(`app.modes.${mode}`)}
    </span>
  )
}

export default AppModeLabel
