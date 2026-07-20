export type SourceProviderCapability = "website-crawl" | "online-document" | "online-drive";

export type SourceProviderAuthKind = "api-key" | "endpoint" | "oauth2";

export interface SourceProviderConfigurationField {
  readonly description?: string | undefined;
  readonly format?: "password" | "uri" | undefined;
  readonly name: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly type: "boolean" | "integer" | "string";
}

export interface SourceProviderDescriptor {
  readonly authKinds: readonly SourceProviderAuthKind[];
  readonly available: boolean;
  readonly capabilities: readonly SourceProviderCapability[];
  readonly configuration: readonly SourceProviderConfigurationField[];
  readonly displayName: string;
  readonly id: string;
  readonly unavailableReason?: string | undefined;
}

export interface SourceProviderCatalog {
  get(providerId: string): Promise<SourceProviderDescriptor | null>;
  list(): Promise<readonly SourceProviderDescriptor[]>;
}

export class SourceProviderUnavailableError extends Error {
  readonly code = "SOURCE_PROVIDER_UNAVAILABLE";

  constructor(readonly providerId: string) {
    super(`Source provider ${providerId} is unavailable`);
    this.name = "SourceProviderUnavailableError";
  }
}

export function createStaticSourceProviderCatalog(
  descriptors: readonly SourceProviderDescriptor[],
): SourceProviderCatalog {
  const providers = new Map<string, SourceProviderDescriptor>();
  for (const descriptor of descriptors) {
    validateDescriptor(descriptor);
    if (providers.has(descriptor.id)) {
      throw new Error(`Duplicate source provider ${descriptor.id}`);
    }
    providers.set(descriptor.id, freezeDescriptor(descriptor));
  }

  return {
    get: async (providerId) => {
      const provider = providers.get(providerId);
      return provider ? cloneDescriptor(provider) : null;
    },
    list: async () =>
      Array.from(providers.values())
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(cloneDescriptor),
  };
}

export async function requireAvailableSourceProvider(
  catalog: SourceProviderCatalog,
  providerId: string,
  capability?: SourceProviderCapability,
): Promise<SourceProviderDescriptor> {
  const provider = await catalog.get(providerId);
  if (!provider || !provider.available) {
    throw new SourceProviderUnavailableError(providerId);
  }
  if (capability && !provider.capabilities.includes(capability)) {
    throw new SourceProviderUnavailableError(providerId);
  }
  return provider;
}

function validateDescriptor(descriptor: SourceProviderDescriptor): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(descriptor.id)) {
    throw new Error("Source provider id must be a stable lowercase identifier");
  }
  if (!descriptor.displayName.trim() || descriptor.displayName.length > 160) {
    throw new Error("Source provider displayName must contain 1-160 characters");
  }
  if (descriptor.authKinds.length === 0 || descriptor.capabilities.length === 0) {
    throw new Error("Source provider must declare auth kinds and capabilities");
  }
  const names = new Set<string>();
  for (const field of descriptor.configuration) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(field.name) || names.has(field.name)) {
      throw new Error("Source provider configuration field names must be unique identifiers");
    }
    names.add(field.name);
    if (field.secret && field.format !== "password") {
      throw new Error("Secret source provider fields must use password format");
    }
  }
}

function freezeDescriptor(descriptor: SourceProviderDescriptor): SourceProviderDescriptor {
  return Object.freeze({
    ...descriptor,
    authKinds: Object.freeze([...new Set(descriptor.authKinds)]),
    capabilities: Object.freeze([...new Set(descriptor.capabilities)]),
    configuration: Object.freeze(
      descriptor.configuration.map((field) => Object.freeze({ ...field })),
    ),
  });
}

function cloneDescriptor(descriptor: SourceProviderDescriptor): SourceProviderDescriptor {
  return {
    ...descriptor,
    authKinds: [...descriptor.authKinds],
    capabilities: [...descriptor.capabilities],
    configuration: descriptor.configuration.map((field) => ({ ...field })),
  };
}
