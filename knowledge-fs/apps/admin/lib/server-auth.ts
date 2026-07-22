const DEFAULT_LOCAL_AUTH_TOKEN = "dev-token";

export function getAdminServerToken(): string | null {
  const explicit =
    process.env.KNOWLEDGE_ADMIN_BFF_TOKEN?.trim() || process.env.KNOWLEDGE_DEV_AUTH_TOKEN?.trim();
  if (explicit) {
    return explicit;
  }

  return process.env.NODE_ENV === "production" ? null : DEFAULT_LOCAL_AUTH_TOKEN;
}
