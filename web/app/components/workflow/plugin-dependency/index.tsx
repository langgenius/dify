import {
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from './store'
import ReadyToInstall from '@/app/components/plugins/install-plugin/install-bundle/ready-to-install'
import { InstallStep } from '@/app/components/plugins/types'

const i18nPrefix = 'plugin.installModal'
const PluginDependency = () => {
  const dependencies = useStore(s => s.dependencies)

  const [step, setStep] = useState<InstallStep>(InstallStep.readyToInstall)

  const { t } = useTranslation()
  const getTitle = useCallback(() => {
    if (step === InstallStep.uploadFailed)
      return t(`${i18nPrefix}.uploadFailed`)
    if (step === InstallStep.installed)
      return t(`${i18nPrefix}.installComplete`)

    return t(`${i18nPrefix}.installPlugin`)
  }, [step, t])

  if (!dependencies.length)
    return null

  return (
    <div>
      <div className='flex pt-6 pl-6 pb-3 pr-14 items-start gap-2 self-stretch'>
        <div className='self-stretch text-text-primary title-2xl-semi-bold'>
          {getTitle()}
        </div>
      </div>
      <ReadyToInstall
        step={step}
        onStepChange={setStep}
        allPlugins={dependencies}
        onClose={() => {}}
      />
    </div>
  )
}

export default PluginDependency
