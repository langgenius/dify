import { type ComputeRuntime, createTypeScriptComputeRuntime } from "@knowledge/compute";

/**
 * The API always owns an in-process, deterministic compute runtime. Keeping this assembly helper
 * separate from the gateway preserves a small deployment seam without making compute availability
 * depend on generated artifacts, environment flags, or dynamic module loading.
 */
export function createApiComputeRuntime(): ComputeRuntime {
  return createTypeScriptComputeRuntime();
}
