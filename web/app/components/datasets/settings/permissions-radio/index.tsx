'use client'
import { useTranslation } from 'react-i18next'
import s from './index.module.css'
import classNames from '@/utils/classnames'
import type { DataSet } from '@/models/datasets'

const itemClass = `
  flex items-center w-full sm:w-[234px] h-12 px-3 rounded-xl bg-gray-25 border border-gray-100 cursor-pointer
`
const radioClass = `
  w-4 h-4 border-[2px] border-gray-200 rounded-full
`
type IPermissionsRadioProps = {
  value?: DataSet['permission']
  onChange: (v?: DataSet['permission']) => void
  itemClassName?: string
  disable?: boolean
}

const PermissionsRadio = ({
  value,
  onChange,
  itemClassName,
  disable,
}: IPermissionsRadioProps) => {
  const { t } = useTranslation()
  const options = [
    {
      key: 'only_me',
      text: t('datasetSettings.form.permissionsOnlyMe'),
    },
    {
      key: 'all_team_members',
      text: t('datasetSettings.form.permissionsAllMember'),
    },
  ]

  return (
    <div className={classNames(s.wrapper, 'flex justify-between w-full flex-wrap gap-y-2')}>
      {
        options.map(option => (
          <div
            key={option.key}
            className={classNames(
              itemClass,
              itemClassName,
              s.item,
              option.key === value && s['item-active'],
              disable && s.disable,
            )}
            onClick={() => {
              if (!disable)
                onChange(option.key as DataSet['permission'])
            }}
          >
            <div className={classNames(s['user-icon'], 'mr-3')} />
            <div className='grow text-sm text-gray-900'>{option.text}</div>
            <div className={classNames(radioClass, s.radio)} />
          </div>
        ))
      }
    </div>
  )
}

export default PermissionsRadio
