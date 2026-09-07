import {
  inspectUnstructuredErrorPayload,
  isPdfRasterLimitPayload,
} from "./unstructured-response-safety";

export type UnstructuredResourceRejection =
  | { readonly kind: "pdf" }
  | { readonly kind: "input" | "timeout"; readonly reason: string };

const sandboxRevision = "knowledgefs-unstructured-sandbox-v1";
const inputReasons = new Set([
  "input_bytes",
  "response_bytes",
  "request_metadata_bytes",
  "response_metadata_bytes",
  "memory_bytes",
  "temp_bytes",
  "temp_entries",
  "cpu_seconds",
  "process_limit",
  "worker_resource_limit",
  "worker_terminated",
]);
const documentReasons = new Set([
  "depth",
  "attachments",
  "mime_parts",
  "decoded_bytes",
  "unsupported_attachment",
  "msg_invalid",
  "ole_invalid",
  "mime_invalid",
  "archive_entries",
  "expanded_bytes",
  "archive_path",
  "archive_encrypted",
  "archive_invalid",
  "xml_bytes",
  "xml_member_bytes",
  "xml_entity",
  "xml_depth",
  "xml_nodes",
  "sheets",
  "sheet_extent",
  "sheet_cells",
  "sheet_cell_reference",
  "workbook_cells",
  "multipart_required",
  "multipart_invalid",
  "multipart_fields",
  "multipart_files",
]);

/** Only a confirmed, versioned supervisor rejection can remove transport ambiguity. */
export function classifyUnstructuredResourceResponse(
  response: Response,
  signal: AbortSignal,
): Promise<UnstructuredResourceRejection | undefined> {
  return inspectUnstructuredErrorPayload(response, signal, [413, 422, 500, 504], (payload) => {
    if ((response.status === 500 || response.status === 422) && isPdfRasterLimitPayload(payload)) {
      return { kind: "pdf" };
    }
    if (
      typeof payload !== "object" ||
      payload === null ||
      Object.keys(payload).length !== 1 ||
      !("detail" in payload)
    )
      return undefined;
    const detail = payload.detail;
    if (
      typeof detail !== "object" ||
      detail === null ||
      Object.keys(detail).length !== 3 ||
      !("code" in detail) ||
      !("revision" in detail) ||
      !("reason" in detail)
    )
      return undefined;
    if (
      detail.code !== "PARSER_RESOURCE_REJECTED" ||
      detail.revision !== sandboxRevision ||
      typeof detail.reason !== "string"
    )
      return undefined;
    if (response.status === 504 && detail.reason === "wall_seconds")
      return { kind: "timeout", reason: detail.reason };
    if (
      (response.status === 413 && inputReasons.has(detail.reason)) ||
      (response.status === 422 && documentReasons.has(detail.reason))
    )
      return { kind: "input", reason: detail.reason };
    return undefined;
  });
}
