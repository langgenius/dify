'use client'
import React, { FC } from 'react'
import { useTranslation } from 'react-i18next'
import GroupName from '../../base/group-name'
import MoreLikeThis from './more-like-this'

/*
* Include 
* 1. More like this
*/
const ExperienceEnchanceGroup: FC = () => {
  const { t } = useTranslation()

  return (
    <div className='mt-7'>
      <GroupName name={t('appDebug.feature.groupExperience.title')} />
      <MoreLikeThis />
    </div>
  )
}
export default React.memo(ExperienceEnchanceGroup)
