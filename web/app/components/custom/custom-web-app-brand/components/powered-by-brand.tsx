import DifyLogo from '@/app/components/base/logo/dify-logo'

type PoweredByBrandProps = {
  webappBrandRemoved?: boolean
  workspaceLogo?: string
  webappLogo?: string
  imgKey: number
}

const PoweredByBrand = ({
  webappBrandRemoved,
  workspaceLogo,
  webappLogo,
  imgKey,
}: PoweredByBrandProps) => {
  if (webappBrandRemoved)
    return null

  const previewLogo = workspaceLogo || (webappLogo ? `${webappLogo}?hash=${imgKey}` : '')

  return (
    <>
      <div className="system-2xs-medium-uppercase text-text-tertiary">POWERED BY</div>
      {previewLogo
        ? <img src={previewLogo} alt="logo" className="block h-5 w-auto" />
        : <DifyLogo size="small" />}
    </>
  )
}

export default PoweredByBrand
