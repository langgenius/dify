/**
 * App Asset Types
 *
 * Types for app asset management API - file tree operations,
 * file content management, and asset publishing.
 */

/**
 * Node type enumeration for asset tree nodes
 */
export type AssetNodeType = 'file' | 'folder'

/**
 * Asset node representation (flat storage format)
 * Used in responses for create, update, rename, move, reorder operations
 */
export type AppAssetNode = {
  /** Unique identifier (UUID) */
  id: string
  /** Node type: file or folder */
  node_type: AssetNodeType
  /** Node name (filename or folder name) */
  name: string
  /** Parent folder ID, null for root level */
  parent_id: string | null
  /** Sort order within parent folder (0-based) */
  order: number
  /** File extension without dot, empty for folders */
  extension: string
  /** File size in bytes, 0 for folders */
  size: number
  /** SHA-256 checksum of file content, empty for folders */
  checksum: string
}

/**
 * Asset tree view node (nested format with computed path)
 * Used in tree response with hierarchical structure
 */
export type AppAssetTreeView = {
  /** Unique identifier (UUID) */
  id: string
  /** Node type: file or folder */
  node_type: AssetNodeType
  /** Node name */
  name: string
  /** Full path from root, e.g. '/folder/file.txt' */
  path: string
  /** File extension without dot */
  extension: string
  /** File size in bytes */
  size: number
  /** SHA-256 checksum */
  checksum: string
  /** Child nodes (for folders) */
  children: AppAssetTreeView[]
}

/**
 * Asset tree response (GET /apps/{app_id}/assets/tree)
 */
export type AppAssetTreeResponse = {
  children: AppAssetTreeView[]
}

/**
 * File content response (GET /apps/{app_id}/assets/files/{node_id})
 */
export type AppAssetFileContentResponse = {
  content: string
  metadata?: Record<string, any>
}

/**
 * File download URL response (GET /apps/{app_id}/assets/files/{node_id}/download-url)
 */
export type AppAssetFileDownloadUrlResponse = {
  /** Presigned download URL */
  download_url: string
}

/**
 * Delete node response (DELETE /apps/{app_id}/assets/nodes/{node_id})
 */
export type AppAssetDeleteResponse = {
  result: 'success'
}

/**
 * Published asset tree structure (flat node list)
 */
export type AppAssetFileTree = {
  nodes: AppAssetNode[]
}

/**
 * Publish response (POST /apps/{app_id}/assets/publish)
 */
export type AppAssetPublishResponse = {
  /** Published version ID */
  id: string
  /** Version timestamp */
  version: string
  /** Asset tree snapshot */
  asset_tree: AppAssetFileTree
}

/**
 * Request payload for creating a folder
 */
export type CreateFolderPayload = {
  /** Folder name (1-255 characters) */
  name: string
  /** Parent folder ID, null/undefined for root */
  parent_id?: string | null
}

/**
 * Request payload for creating a file (form data)
 */
export type CreateFilePayload = {
  /** File name (1-255 characters) */
  name: string
  /** Parent folder ID, empty or undefined for root */
  parent_id?: string | null
}

/**
 * Request payload for updating file content (JSON)
 */
export type UpdateFileContentPayload = {
  /** New file content (UTF-8) */
  content: string
  /** Optional metadata associated with the file */
  metadata?: Record<string, any>
}

/**
 * Request payload for renaming a node
 */
export type RenameNodePayload = {
  /** New name (1-255 characters) */
  name: string
}

/**
 * Request payload for moving a node
 */
export type MoveNodePayload = {
  /** Target parent folder ID, null for root */
  parent_id: string | null
}

/**
 * Request payload for reordering a node
 */
export type ReorderNodePayload = {
  /** Place after this node ID, null for first position */
  after_node_id: string | null
}
