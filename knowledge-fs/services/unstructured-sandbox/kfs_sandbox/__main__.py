"""Keep one supervisor so admission covers every client of this deployment."""

import uvicorn


if __name__ == "__main__":
    uvicorn.run(
        "kfs_sandbox.gateway:app",
        host="0.0.0.0",
        port=8000,
        workers=1,
        limit_concurrency=64,
        timeout_keep_alive=5,
        timeout_graceful_shutdown=10,
        access_log=False,
        ws="none",
    )
