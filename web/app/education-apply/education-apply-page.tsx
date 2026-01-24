'use client'

import { RiExternalLinkLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import {
  useRouter,
  useSearchParams,
} from 'next/navigation'
import {
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Checkbox from '@/app/components/base/checkbox'
import { useToastContext } from '@/app/components/base/toast'
import { EDUCATION_VERIFYING_LOCALSTORAGE_ITEM } from '@/app/education-apply/constants'
import { useDocLink } from '@/context/i18n'
import { useProviderContext } from '@/context/provider-context'
import {
  useEducationAdd,
  useInvalidateEducationStatus,
} from '@/service/use-education'
import DifyLogo from '../components/base/logo/dify-logo'
import RoleSelector from './role-selector'
import SearchInput from './search-input'
import UserInfo from './user-info'
import Confirm from './verify-state-modal'

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
  const [modalShow, setShowModal] = useState<undefined | { title: string, desc: string, onConfirm?: () => void }>(undefined)
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
          title: t('successTitle', { ns: 'education' }),
          desc: t('successContent', { ns: 'education' }),
          onConfirm: handleModalConfirm,
        })
      }
      else {
        notify({
          type: 'error',
          message: t('submitError', { ns: 'education' }),
        })
      }
    })
  }

  return (
    <div className="fixed inset-0 z-[31] overflow-y-auto bg-background-body p-6">
      <div className="mx-auto w-full max-w-[1408px] rounded-2xl border border-effects-highlight bg-background-default-subtle">
        <div
          className="h-[349px] w-full overflow-hidden rounded-t-2xl bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: 'url(/education/bg.png)',
          }}
        >
        </div>
        <div className="mt-[-349px] box-content flex h-7 items-center justify-between p-6">
          <DifyLogo size="large" style="monochromeWhite" />
        </div>
        <div className="mx-auto max-w-[720px] px-8 pb-[180px]">
          <div className="mb-2 flex h-[192px] flex-col justify-end pb-4 pt-3 text-text-primary-on-surface">
            <div className="title-5xl-bold mb-2 shadow-xs">{t('toVerified', { ns: 'education' })}</div>
            <div className="system-md-medium shadow-xs">
              {t('toVerifiedTip.front', { ns: 'education' })}
&nbsp;
              <span className="system-md-semibold underline">{t('toVerifiedTip.coupon', { ns: 'education' })}</span>
&nbsp;
              {t('toVerifiedTip.end', { ns: 'education' })}
            </div>
          </div>
          <div className="mb-7">
            <UserInfo />
          </div>
          <div className="mb-7">
            <div className="system-md-semibold mb-1 flex h-6 items-center text-text-secondary">
              {t('form.schoolName.title', { ns: 'education' })}
            </div>
            <SearchInput
              value={schoolName}
              onChange={setSchoolName}
            />
          </div>
          <div className="mb-7">
            <div className="system-md-semibold mb-1 flex h-6 items-center text-text-secondary">
              {t('form.schoolRole.title', { ns: 'education' })}
            </div>
            <RoleSelector
              value={role}
              onChange={setRole}
            />
          </div>
          <div className="mb-7">
            <div className="system-md-semibold mb-1 flex h-6 items-center text-text-secondary">
              {t('form.terms.title', { ns: 'education' })}
            </div>
            <div className="system-md-regular mb-1 text-text-tertiary">
              {t('form.terms.desc.front', { ns: 'education' })}
&nbsp;
              <a href="https://dify.ai/terms" target="_blank" className="text-text-secondary hover:underline">{t('form.terms.desc.termsOfService', { ns: 'education' })}</a>
&nbsp;
              {t('form.terms.desc.and', { ns: 'education' })}
&nbsp;
              <a href="https://dify.ai/privacy" target="_blank" className="text-text-secondary hover:underline">{t('form.terms.desc.privacyPolicy', { ns: 'education' })}</a>
              {t('form.terms.desc.end', { ns: 'education' })}
            </div>
            <div className="system-md-regular py-2 text-text-primary">
              <div className="mb-2 flex">
                <Checkbox
                  className="mr-2 shrink-0"
                  checked={ageChecked}
                  onCheck={() => setAgeChecked(!ageChecked)}
                />
                {t('form.terms.option.age', { ns: 'education' })}
              </div>
              <div className="flex">
                <Checkbox
                  className="mr-2 shrink-0"
                  checked={inSchoolChecked}
                  onCheck={() => setInSchoolChecked(!inSchoolChecked)}
                />
                {t('form.terms.option.inSchool', { ns: 'education' })}
              </div>
            </div>
          </div>
          <Button
            variant="primary"
            disabled={!ageChecked || !inSchoolChecked || !schoolName || !role || isPending}
            onClick={handleSubmit}
          >
            {t('submit', { ns: 'education' })}
          </Button>
          <div className="mb-4 mt-5 h-px bg-gradient-to-r from-[rgba(16,24,40,0.08)]"></div>
          <a
            className="system-xs-regular flex items-center text-text-accent"
            href={docLink('/use-dify/workspace/subscription-management#dify-for-education')}
            target="_blank"
          >
            {t('learn', { ns: 'education' })}
            <RiExternalLinkLine className="ml-1 h-3 w-3" />
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
