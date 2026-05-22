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
  const previewLogo = workspaceLogo || (webappLogo ? `${webappLogo}?hash=${imgKey}` : '')

  if (!previewLogo)
    return null

  return (
    <img src={previewLogo} alt="logo" className="block h-5 w-auto" />
  )
}

export default PoweredByBrand
