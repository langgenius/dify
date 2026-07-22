import { z } from "zod";

import {
  type AuthSubject,
  type KnowledgeSpaceConsistencyClass,
  KnowledgeSpaceConsistencyClassSchema,
  type ResourceMount,
} from "./models";

export const CommandNameSchema = z.enum([
  "ls",
  "tree",
  "cat",
  "grep",
  "find",
  "stat",
  "diff",
  "head",
  "tail",
  "wc",
  "jq",
  "open_node",
  "write",
  "append",
]);
export type CommandName = z.infer<typeof CommandNameSchema>;

export type RegisteredCommandResourceType = ResourceMount["resourceType"];

export interface RegisteredCommandContext {
  readonly consistencyClass?: KnowledgeSpaceConsistencyClass;
  readonly nodeKind?: string;
  readonly resourceType: RegisteredCommandResourceType;
  readonly subject: AuthSubject;
  readonly traceId?: string;
}

export interface CommandCostEstimate {
  readonly estimatedBytes?: number;
  readonly estimatedRows?: number;
  readonly estimatedMs?: number;
}

export interface CommandCachePolicy {
  readonly maxBytes?: number;
  readonly strategy: "none" | "memory" | "object-storage";
  readonly ttlSeconds?: number;
}

export interface CommandDegradationPolicy {
  readonly strategy: "fail-closed" | "fallback" | "partial";
}

export type RegisteredCommandHandler<TInput, TOutput> = (args: {
  readonly context: RegisteredCommandContext;
  readonly input: TInput;
}) => Promise<TOutput> | TOutput;

export type CommandPermissionCheck<TInput> = (args: {
  readonly context: RegisteredCommandContext;
  readonly input: TInput;
  readonly subject: AuthSubject;
}) => Promise<boolean> | boolean;

export type CommandCostEstimator<TInput> = (args: {
  readonly context: RegisteredCommandContext;
  readonly input: TInput;
}) => Promise<CommandCostEstimate> | CommandCostEstimate;

export type CommandTraceHook = (args: {
  readonly cost?: CommandCostEstimate;
  readonly context: RegisteredCommandContext;
  readonly durationMs?: number;
  readonly error?: unknown;
  readonly event: "command.start" | "command.end" | "command.error";
  readonly name: CommandName;
}) => Promise<void> | void;

export interface RegisteredCommandDefinition<TInput = unknown, TOutput = unknown> {
  readonly cachePolicy?: CommandCachePolicy;
  readonly defaultHandler: RegisteredCommandHandler<TInput, TOutput>;
  readonly degradation?: CommandDegradationPolicy;
  readonly estimateCost?: CommandCostEstimator<TInput>;
  readonly inputSchema: z.ZodType<TInput>;
  readonly name: CommandName;
  readonly nodeKindOverrides?: Readonly<Record<string, RegisteredCommandHandler<TInput, TOutput>>>;
  readonly outputSchema?: z.ZodType<TOutput>;
  readonly permissionCheck?: CommandPermissionCheck<TInput>;
  readonly resourceTypeOverrides?: Partial<
    Record<RegisteredCommandResourceType, RegisteredCommandHandler<TInput, TOutput>>
  >;
  readonly supportedResourceTypes: readonly RegisteredCommandResourceType[];
  readonly traceHook?: CommandTraceHook;
}

export interface RegisteredCommandSummary {
  readonly cachePolicy?: CommandCachePolicy;
  readonly degradation?: CommandDegradationPolicy;
  readonly name: CommandName;
  readonly supportedResourceTypes: readonly RegisteredCommandResourceType[];
}

export interface CommandExecutionInput {
  readonly context: RegisteredCommandContext;
  readonly input: unknown;
  readonly name: CommandName;
}

export interface CommandExecutionResult<TOutput = unknown> {
  readonly cost?: CommandCostEstimate;
  readonly output: TOutput;
}

export interface CommandRegistry {
  execute<TOutput = unknown>(
    input: CommandExecutionInput,
  ): Promise<CommandExecutionResult<TOutput>>;
  get(name: CommandName): RegisteredCommandSummary | null;
  list(): RegisteredCommandSummary[];
  register<TInput, TOutput>(definition: RegisteredCommandDefinition<TInput, TOutput>): void;
}

export interface CreateCommandRegistryOptions {
  readonly maxCommands: number;
}

type StoredCommandDefinition = RegisteredCommandDefinition<unknown, unknown>;

export function createCommandRegistry(options: CreateCommandRegistryOptions): CommandRegistry {
  if (!Number.isInteger(options.maxCommands) || options.maxCommands < 1) {
    throw new Error("maxCommands must be at least 1");
  }

  const commands = new Map<CommandName, StoredCommandDefinition>();

  return {
    async execute<TOutput = unknown>(
      input: CommandExecutionInput,
    ): Promise<CommandExecutionResult<TOutput>> {
      const name = parseCommandName(input.name);
      const definition = commands.get(name);

      if (!definition) {
        throw new Error(`Command ${name} is not registered`);
      }

      if (!definition.supportedResourceTypes.includes(input.context.resourceType)) {
        throw new Error(
          `Command ${name} does not support resource type ${input.context.resourceType}`,
        );
      }

      const parsedInput = definition.inputSchema.parse(input.input);
      const executionContext = mergeInputConsistencyClass(input.context, parsedInput);
      const startedAt = Date.now();

      if (definition.permissionCheck) {
        const permitted = await definition.permissionCheck({
          context: executionContext,
          input: parsedInput,
          subject: executionContext.subject,
        });

        if (!permitted) {
          throw new Error(`Command ${name} permission denied`);
        }
      }

      await definition.traceHook?.({
        context: executionContext,
        event: "command.start",
        name,
      });

      try {
        const cost = definition.estimateCost
          ? validateCostEstimate(
              name,
              await definition.estimateCost({ context: executionContext, input: parsedInput }),
            )
          : undefined;
        const handler = selectHandler(definition, executionContext);
        const output = validateCommandOutput(
          name,
          definition,
          await handler({ context: executionContext, input: parsedInput }),
        );

        await definition.traceHook?.({
          ...(cost ? { cost } : {}),
          context: executionContext,
          durationMs: Date.now() - startedAt,
          event: "command.end",
          name,
        });

        return cost
          ? {
              cost,
              output: output as TOutput,
            }
          : {
              output: output as TOutput,
            };
      } catch (error) {
        await definition.traceHook?.({
          context: executionContext,
          durationMs: Date.now() - startedAt,
          error,
          event: "command.error",
          name,
        });
        throw error;
      }
    },

    get(name: CommandName): RegisteredCommandSummary | null {
      const definition = commands.get(parseCommandName(name));

      return definition ? summarizeCommand(definition) : null;
    },

    list(): RegisteredCommandSummary[] {
      return [...commands.values()].map((definition) => summarizeCommand(definition));
    },

    register<TInput, TOutput>(definition: RegisteredCommandDefinition<TInput, TOutput>): void {
      const name = parseCommandName(definition.name);
      validateCommandDefinition(name, definition);

      if (commands.has(name)) {
        throw new Error(`Command ${name} is already registered`);
      }

      if (commands.size >= options.maxCommands) {
        throw new Error(`Command registry maxCommands=${options.maxCommands} exceeded`);
      }

      commands.set(name, {
        ...definition,
        name,
        supportedResourceTypes: [...definition.supportedResourceTypes],
      } as StoredCommandDefinition);
    },
  };
}

function mergeInputConsistencyClass(
  context: RegisteredCommandContext,
  input: unknown,
): RegisteredCommandContext {
  if (!isRecord(input) || !("consistencyClass" in input)) {
    return context;
  }

  const parsed = KnowledgeSpaceConsistencyClassSchema.optional().safeParse(input.consistencyClass);

  if (!parsed.success || parsed.data === undefined) {
    return context;
  }

  return {
    ...context,
    consistencyClass: parsed.data,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCommandName(name: unknown): CommandName {
  const parsed = CommandNameSchema.safeParse(name);

  if (!parsed.success) {
    throw new Error(`Command ${String(name)} is not allowlisted`);
  }

  return parsed.data;
}

function validateCommandDefinition<TInput, TOutput>(
  name: CommandName,
  definition: RegisteredCommandDefinition<TInput, TOutput>,
) {
  if (definition.supportedResourceTypes.length < 1) {
    throw new Error(`Command ${name} must support at least one resource type`);
  }

  const resourceTypes = new Set<RegisteredCommandResourceType>();

  for (const resourceType of definition.supportedResourceTypes) {
    if (resourceTypes.has(resourceType)) {
      throw new Error(`Command ${name} has duplicate supported resource type ${resourceType}`);
    }
    resourceTypes.add(resourceType);
  }

  validateOptionalPositiveInteger(
    definition.cachePolicy?.maxBytes,
    `Command ${name} cachePolicy.maxBytes`,
  );
  validateOptionalPositiveInteger(
    definition.cachePolicy?.ttlSeconds,
    `Command ${name} cachePolicy.ttlSeconds`,
  );
}

function validateCostEstimate(name: CommandName, cost: CommandCostEstimate): CommandCostEstimate {
  validateOptionalNonNegativeFinite(
    cost.estimatedBytes,
    `Command ${name} cost estimate estimatedBytes`,
  );
  validateOptionalNonNegativeFinite(
    cost.estimatedRows,
    `Command ${name} cost estimate estimatedRows`,
  );
  validateOptionalNonNegativeFinite(cost.estimatedMs, `Command ${name} cost estimate estimatedMs`);

  return { ...cost };
}

function validateCommandOutput(
  name: CommandName,
  definition: StoredCommandDefinition,
  output: unknown,
): unknown {
  if (!definition.outputSchema) {
    return output;
  }

  const parsed = definition.outputSchema.safeParse(output);

  if (!parsed.success) {
    throw new Error(`Command ${name} returned invalid output`, { cause: parsed.error });
  }

  return parsed.data;
}

function validateOptionalPositiveInteger(value: number | undefined, label: string) {
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be at least 1`);
  }
}

function validateOptionalNonNegativeFinite(value: number | undefined, label: string) {
  if (value === undefined) {
    return;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be non-negative finite number`);
  }
}

function selectHandler(
  definition: StoredCommandDefinition,
  context: RegisteredCommandContext,
): RegisteredCommandHandler<unknown, unknown> {
  if (context.nodeKind) {
    const nodeHandler = definition.nodeKindOverrides?.[context.nodeKind];

    if (nodeHandler) {
      return nodeHandler;
    }
  }

  const resourceHandler = definition.resourceTypeOverrides?.[context.resourceType];

  return resourceHandler ?? definition.defaultHandler;
}

function summarizeCommand(definition: StoredCommandDefinition): RegisteredCommandSummary {
  return {
    ...(definition.cachePolicy ? { cachePolicy: { ...definition.cachePolicy } } : {}),
    ...(definition.degradation ? { degradation: { ...definition.degradation } } : {}),
    name: definition.name,
    supportedResourceTypes: [...definition.supportedResourceTypes],
  };
}
