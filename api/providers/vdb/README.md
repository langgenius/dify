# VDB providers

This directory contains all VDB providers.

## Architecture
1. **Core** (`api/core/rag/datasource/vdb/`) defines the contracts and loads plugins.
2. **Each provider** (`api/providers/vdb/<backend>/`) implements those contracts and registers an entry point.
3. At runtime, **`importlib.metadata.entry_points`** resolves the backend name (e.g. `pgvector`) to a factory class. The registry caches loaded classes (see `vector_backend_registry.py`).

### Interfaces

| Piece | Role |
|--------|----------|
| `AbstractVectorFactory`  | You subclass this. Implement `init_vector(dataset, attributes, embeddings) -> BaseVector`. Optionally use `gen_index_struct_dict()` for new datasets. |
| `BaseVector` | Your store class subclasses this: `create`, `add_texts`, `search_by_vector`, `delete`, etc. |
| `VectorType` | `StrEnum` of supported backend **string ids**. Add a member when you introduce a new backend that should be selectable like existing ones. |
| Discovery | Loads `dify.vector_backends` entry points and caches `get_vector_factory_class(vector_type)`. |

The high-level caller is `Vector` in `vector_factory.py`: it reads the configured or dataset-specific vector type, calls `get_vector_factory_class`, instantiates the factory, and uses the returned `BaseVector` implementation.

### Entry point name must match the vector type string

Entry points are registered under the group **`dify.vector_backends`**. The **entry point name** (left-hand side) must be exactly the string used as `vector_type` everywhere else—typically the **`VectorType` enum value** (e.g. `PGVECTOR = "pgvector"` → entry point name `pgvector`; `TIDB_ON_QDRANT = "tidb_on_qdrant"` → `tidb_on_qdrant`).

In `pyproject.toml`:

```toml
[project.entry-points."dify.vector_backends"]
pgvector = "dify_vdb_pgvector.pgvector:PGVectorFactory"
```

The value is **`module:attribute`**: a importable module path and the class implementing `AbstractVectorFactory`.

### How registration works

1. On first use, `get_vector_factory_class(vector_type)` looks up `vector_type` in a process cache.
2. If missing, it scans **`entry_points().select(group="dify.vector_backends")`** for an entry whose **`name` equals `vector_type`**.
3. It loads that entry (`ep.load()`), which must return the **factory class** (not an instance).
4. There is an optional internal map `_BUILTIN_VECTOR_FACTORY_TARGETS` for non-distribution builtins; **normal VDB plugins use entry points only**.

After you change a provider’s `pyproject.toml` (entry points or dependencies), run **`uv sync`** in `api/` so the installed environment’s dist-info matches the project metadata.

### Package layout (VDB)

Each backend usually follows:

- `api/providers/vdb/<backend>/pyproject.toml` — project name `dify-vdb-<backend>`, dependencies, entry points.
- `api/providers/vdb/<backend>/src/dify_vdb_<python_package>/` — implementation (e.g. `PGVector`, `PGVectorFactory`).

See `vdb/pgvector/` as a reference implementation.

### Wiring a new backend into the API workspace

The API uses a **uv workspace** (`api/pyproject.toml`):

1. **`[tool.uv.workspace]`** — `members = ["providers/vdb/*"]` already includes every subdirectory under `vdb/`; new folders there are workspace members.
2. **`[tool.uv.sources]`** — add a line for your package: `dify-vdb-mine = { workspace = true }`.
3. **`[project.optional-dependencies]`** — add a group such as `vdb-mine = ["dify-vdb-mine"]`, and list `dify-vdb-mine` under `vdb-all` if it should install with the default bundle.