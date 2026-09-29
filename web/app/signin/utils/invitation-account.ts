export const isInvitationForAccount = (
  invitationEmail?: string | null,
  accountEmail?: string | null,
) =>
  Boolean(
    invitationEmail &&
    accountEmail &&
    invitationEmail.trim().toLowerCase() === accountEmail.trim().toLowerCase(),
  )
