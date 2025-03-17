'use client'

import {
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import UserInfo from './user-info'
import SearchInput from './search-input'
import RoleSelector from './role-selector'
import Confirm from './verify-state-modal'
import Button from '@/app/components/base/button'
import Checkbox from '@/app/components/base/checkbox'
import {
  useEducationAdd,
  useEducationVerify,
  useInvalidateEducationStatus,
} from '@/service/use-education'
import { useProviderContext } from '@/context/provider-context'
import { useToastContext } from '@/app/components/base/toast'
import { EDUCATION_VERIFYING_LOCALSTORAGE_ITEM } from '@/app/education-apply/components/constants'

const EducationApplyAge = () => {
  const { t } = useTranslation()
  const [schoolName, setSchoolName] = useState('')
  const [role, setRole] = useState('Student')
  const [ageChecked, setAgeChecked] = useState(false)
  const [inSchoolChecked, setInSchoolChecked] = useState(false)
  const {
    isPending,
    mutateAsync: educationAdd,
  } = useEducationAdd({ onSuccess: () => {} })
  const [modalShow, setShowModal] = useState<undefined | { title: string; desc: string; onConfirm?: () => void }>(undefined)
  const { data } = useEducationVerify()
  const { onPlanInfoChanged } = useProviderContext()
  const updateEducationStatus = useInvalidateEducationStatus()
  const { notify } = useToastContext()
  const router = useRouter()

  const handleModalConfirm = () => {
    setShowModal(undefined)
    onPlanInfoChanged()
    updateEducationStatus()
    localStorage.removeItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM)
    router.replace('/')
  }

  const handleSubmit = () => {
    educationAdd({
      token: data?.token || '',
      role,
      institution: schoolName,
    }).then((res) => {
      if (res.message === 'success') {
        setShowModal({
          title: t('education.successTitle'),
          desc: t('education.successContent'),
          onConfirm: handleModalConfirm,
        })
      }
      else {
        notify({
          type: 'error',
          message: t('education.submitError'),
        })
      }
    })
  }

  return (
    <div className='flex justify-center p-6 w-full h-full'>
      <div className='relative max-w-[1408px] w-full border border-effects-highlight bg-background-default-subtle rounded-2xl'>
        <div
          className="absolute top-0 w-full h-[349px] rounded-t-2xl overflow-hidden bg-no-repeat bg-cover bg-center"
          style={{
            backgroundImage: 'url(/education/bg.png)',
          }}
        >
        </div>
        <div className='relative flex items-center justify-between px-8 py-6 h-[88px] z-10'>
          <img
            src='/logo/logo-site-dark.png'
            alt='dify logo'
            className='h-10'
          />
        </div>
        <div className='relative m-auto px-8 max-w-[720px] z-10'>
          <div className='flex flex-col justify-end mb-2 pt-3 pb-4 h-[192px] text-text-primary-on-surface'>
            <div className='mb-2 title-5xl-bold shadow-xs'>{t('education.toVerified')}</div>
            <div className='system-md-medium shadow-xs'>
              {t('education.toVerifiedTip.front')}&nbsp;
              <span className='system-md-semibold underline'>{t('education.toVerifiedTip.coupon')}</span>&nbsp;
              {t('education.toVerifiedTip.end')}
            </div>
          </div>
          <div className='mb-7'>
            <UserInfo />
          </div>
          <div className='mb-7'>
            <div className='flex items-center mb-1 h-6 system-md-semibold text-text-secondary'>
              {t('education.form.schoolName.title')}
            </div>
            <SearchInput
              value={schoolName}
              onChange={setSchoolName}
            />
          </div>
          <div className='mb-7'>
            <div className='flex items-center mb-1 h-6 system-md-semibold text-text-secondary'>
              {t('education.form.schoolRole.title')}
            </div>
            <RoleSelector
              value={role}
              onChange={setRole}
            />
          </div>
          <div className='mb-7'>
            <div className='flex items-center mb-1 h-6 system-md-semibold text-text-secondary'>
              {t('education.form.terms.title')}
            </div>
            <div className='mb-1 system-md-regular text-text-tertiary'>
              {t('education.form.terms.desc.front')}&nbsp;
              <a href='https://dify.ai/terms' target='_blank' className='text-text-secondary hover:underline'>{t('education.form.terms.desc.termsOfService')}</a>&nbsp;
              {t('education.form.terms.desc.and')}&nbsp;
              <a href='https://dify.ai/privacy' target='_blank' className='text-text-secondary hover:underline'>{t('education.form.terms.desc.privacyPolicy')}</a>&nbsp;
              {t('education.form.terms.desc.end')}
            </div>
            <div className='py-2 system-md-regular text-text-primary'>
              <div className='flex mb-2'>
                <Checkbox
                  className='shrink-0 mr-2'
                  checked={ageChecked}
                  onCheck={() => setAgeChecked(!ageChecked)}
                />
                {t('education.form.terms.option.age')}
              </div>
              <div className='flex'>
                <Checkbox
                  className='shrink-0 mr-2'
                  checked={inSchoolChecked}
                  onCheck={() => setInSchoolChecked(!inSchoolChecked)}
                />
                {t('education.form.terms.option.inSchool')}
              </div>
            </div>
          </div>
          <Button
            variant='primary'
            disabled={!ageChecked || !inSchoolChecked || !schoolName || !role || isPending}
            onClick={handleSubmit}
          >
            {t('education.submit')}
          </Button>
        </div>
      </div>
      <Confirm
        isShow={!!modalShow}
        title={modalShow?.title || ''}
        content={modalShow?.desc}
        onConfirm={modalShow?.onConfirm || (() => {})}
        onCancel={modalShow?.onConfirm || (() => {})}
      />
    </div>
  )
}

export default EducationApplyAge
