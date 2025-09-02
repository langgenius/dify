'use client'

import {
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiExternalLinkLine } from '@remixicon/react'
import {
  useRouter,
  useSearchParams,
} from 'next/navigation'
import UserInfo from './user-info'
import SearchInput from './search-input'
import RoleSelector from './role-selector'
import Confirm from './verify-state-modal'
import Button from '@/app/components/base/button'
import Checkbox from '@/app/components/base/checkbox'
import {
  useEducationAdd,
  useInvalidateEducationStatus,
} from '@/service/use-education'
import { useProviderContext } from '@/context/provider-context'
import { useToastContext } from '@/app/components/base/toast'
import { EDUCATION_VERIFYING_LOCALSTORAGE_ITEM } from '@/app/education-apply/constants'
import { noop } from 'lodash-es'
import DifyLogo from '../components/base/logo/dify-logo'
import { useDocLink } from '@/context/i18n'
const EducationApplyAge = () => {
  const { t } = useTranslation()
  const [schoolName, setSchoolName] = useState('')
  const [role, setRole] = useState('Student')
  const [ageChecked, setAgeChecked] = useState(false)
  const [inSchoolChecked, setInSchoolChecked] = useState(false)
  const {
    isPending,
    mutateAsync: educationAdd,
  } = useEducationAdd({ onSuccess: noop })
  const [modalShow, setShowModal] = useState<undefined | { title: string; desc: string; onConfirm?: () => void }>(undefined)
  const { onPlanInfoChanged } = useProviderContext()
  const updateEducationStatus = useInvalidateEducationStatus()
  const { notify } = useToastContext()
  const router = useRouter()
  const docLink = useDocLink()

  const handleModalConfirm = () => {
    setShowModal(undefined)
    onPlanInfoChanged()
    updateEducationStatus()
    localStorage.removeItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM)
    router.replace('/')
  }

  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const handleSubmit = () => {
    educationAdd({
      token: token || '',
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
    <div className='fixed inset-0 z-[31] overflow-y-auto bg-background-body p-6'>
      <div className='mx-auto w-full max-w-[1408px] rounded-2xl border border-effects-highlight bg-background-default-subtle'>
        <div
          className="h-[349px] w-full overflow-hidden rounded-t-2xl bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: 'url(/education/bg.png)',
          }}
        >
        </div>
        <div className='mt-[-349px] box-content flex h-7 items-center justify-between p-6'>
          <DifyLogo size='large' style='monochromeWhite' />
        </div>
        <div className='mx-auto max-w-[720px] px-8 pb-[180px]'>
          <div className='mb-2 flex h-[192px] flex-col justify-end pb-4 pt-3 text-text-primary-on-surface'>
            <div className='title-5xl-bold mb-2 shadow-xs'>{t('education.toVerified')}</div>
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
            <div className='system-md-semibold mb-1 flex h-6 items-center text-text-secondary'>
              {t('education.form.schoolName.title')}
            </div>
            <SearchInput
              value={schoolName}
              onChange={setSchoolName}
            />
          </div>
          <div className='mb-7'>
            <div className='system-md-semibold mb-1 flex h-6 items-center text-text-secondary'>
              {t('education.form.schoolRole.title')}
            </div>
            <RoleSelector
              value={role}
              onChange={setRole}
            />
          </div>
          <div className='mb-7'>
            <div className='system-md-semibold mb-1 flex h-6 items-center text-text-secondary'>
              {t('education.form.terms.title')}
            </div>
            <div className='system-md-regular mb-1 text-text-tertiary'>
              {t('education.form.terms.desc.front')}&nbsp;
              <a href='https://dify.ai/terms' target='_blank' className='text-text-secondary hover:underline'>{t('education.form.terms.desc.termsOfService')}</a>&nbsp;
              {t('education.form.terms.desc.and')}&nbsp;
              <a href='https://dify.ai/privacy' target='_blank' className='text-text-secondary hover:underline'>{t('education.form.terms.desc.privacyPolicy')}</a>
              {t('education.form.terms.desc.end')}
            </div>
            <div className='system-md-regular py-2 text-text-primary'>
              <div className='mb-2 flex'>
                <Checkbox
                  className='mr-2 shrink-0'
                  checked={ageChecked}
                  onCheck={() => setAgeChecked(!ageChecked)}
                />
                {t('education.form.terms.option.age')}
              </div>
              <div className='flex'>
                <Checkbox
                  className='mr-2 shrink-0'
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
          <div className='mb-4 mt-5 h-px bg-gradient-to-r from-[rgba(16,24,40,0.08)]'></div>
          <a
            className='system-xs-regular flex items-center text-text-accent'
            href={docLink('/getting-started/dify-for-education')}
            target='_blank'
          >
            {t('education.learn')}
            <RiExternalLinkLine className='ml-1 h-3 w-3' />
          </a>
        </div>
      </div>
      <Confirm
        isShow={!!modalShow}
        title={modalShow?.title || ''}
        content={modalShow?.desc}
        onConfirm={modalShow?.onConfirm || noop}
        onCancel={modalShow?.onConfirm || noop}
      />
    </div>
  )
}

export default EducationApplyAge
