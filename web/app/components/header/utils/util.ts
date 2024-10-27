export const generateMailToLink = (email: string, subject?: string, body?: string): string => {
  let mailtoLink = `mailto:${email}`

  if (subject)
    mailtoLink += `?subject=${encodeURIComponent(subject)}`

  if (body)
    mailtoLink += `&body=${encodeURIComponent(body)}`

  return mailtoLink
}

export const mailToSupport = (account: string, plan: string, version: string) => {
  const subject = `Technical Support Request ${plan} ${account}`
  const body = `
    Please do not remove the following information:
    -----------------------------------------------
    Current Plan: ${plan}
    Account: ${account}
    Version: ${version}
    Platform:
    Problem Description:
  `
  return generateMailToLink('support@dify.ai', subject, body)
}
