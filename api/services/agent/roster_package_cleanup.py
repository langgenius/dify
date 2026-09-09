"""Retry failed package imports without deleting files still referenced by the database.

Pending jobs have no expiry. The sorted-set index lets a periodic worker retry
both database and storage outages, including a failure to publish a task.
"""

from __future__ import annotations

import time
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, select

from core.db.session_factory import session_factory
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigRevision,
    AgentConfigSnapshot,
    AgentDebugConversation,
    AgentScope,
)
from models.model import App, AppModelConfig, Conversation, InstalledApp, Site, UploadFile
from models.tools import ToolFile

_PENDING_KEY = "roster_package_cleanup:pending"
_JOB_PREFIX = "roster_package_cleanup:job:"


class CleanupResource(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    kind: Literal["tool_file", "upload_file"]
    storage_key: str


class PackageCleanupJob(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tenant_id: str
    app_id: str
    resources: list[CleanupResource] = Field(default_factory=list)
    database_removed: bool = False

    @property
    def key(self) -> str:
        return f"{self.tenant_id}:{self.app_id}"


class CleanupStorage(Protocol):
    def delete(self, filename: str) -> None: ...


class PackageCleanupCache:
    def save(self, job: PackageCleanupJob) -> None:
        with redis_client.pipeline(transaction=True) as pipe:
            pipe.set(f"{_JOB_PREFIX}{job.key}", job.model_dump_json())
            pipe.zadd(_PENDING_KEY, {job.key: time.time() + 60})
            pipe.execute()

    def load(self, key: str) -> PackageCleanupJob | None:
        payload = redis_client.get(f"{_JOB_PREFIX}{key}")
        return PackageCleanupJob.model_validate_json(payload) if payload is not None else None

    def complete(self, key: str) -> None:
        with redis_client.pipeline(transaction=True) as pipe:
            pipe.delete(f"{_JOB_PREFIX}{key}")
            pipe.zrem(_PENDING_KEY, key)
            pipe.execute()

    def due(self) -> list[str]:
        return [
            value.decode() if isinstance(value, bytes) else value
            for value in redis_client.zrangebyscore(_PENDING_KEY, "-inf", time.time(), start=0, num=100)
        ]


class RosterPackageCleanup:
    def __init__(self, *, cache: PackageCleanupCache | None = None, storage_backend: CleanupStorage = storage):
        self.cache = cache or PackageCleanupCache()
        self.storage = storage_backend

    def run(self, key: str) -> None:
        job = self.cache.load(key)
        if job is None:
            # A duplicate delivery may arrive after the successful cleanup.
            self.cache.complete(key)
            return
        if job.key != key:
            raise ValueError("Package cleanup job identity mismatch")
        if not job.database_removed:
            self._remove_database(job)
            job.database_removed = True
            # Do not advance to physical deletion unless the checkpoint succeeds.
            self.cache.save(job)
        for resource in job.resources:
            try:
                self.storage.delete(resource.storage_key)
            except FileNotFoundError:
                pass
        self.cache.complete(key)

    @staticmethod
    def _remove_database(job: PackageCleanupJob) -> None:
        tool_file_ids = [item.id for item in job.resources if item.kind == "tool_file"]
        upload_file_ids = [item.id for item in job.resources if item.kind == "upload_file"]
        with session_factory.create_session() as session, session.begin():
            agent_ids = list(
                session.scalars(
                    select(Agent.id).where(
                        Agent.tenant_id == job.tenant_id,
                        Agent.app_id == job.app_id,
                        Agent.scope == AgentScope.ROSTER,
                    )
                ).all()
            )
            if agent_ids:
                session.execute(
                    delete(AgentDebugConversation).where(
                        AgentDebugConversation.tenant_id == job.tenant_id,
                        AgentDebugConversation.agent_id.in_(agent_ids),
                    )
                )
                session.execute(
                    delete(AgentConfigDraft).where(
                        AgentConfigDraft.tenant_id == job.tenant_id,
                        AgentConfigDraft.agent_id.in_(agent_ids),
                    )
                )
                session.execute(
                    delete(AgentConfigRevision).where(
                        AgentConfigRevision.tenant_id == job.tenant_id,
                        AgentConfigRevision.agent_id.in_(agent_ids),
                    )
                )
                session.execute(
                    delete(AgentConfigSnapshot).where(
                        AgentConfigSnapshot.tenant_id == job.tenant_id,
                        AgentConfigSnapshot.agent_id.in_(agent_ids),
                    )
                )
                session.execute(delete(Agent).where(Agent.tenant_id == job.tenant_id, Agent.id.in_(agent_ids)))
            session.execute(delete(Conversation).where(Conversation.app_id == job.app_id))
            session.execute(delete(Site).where(Site.app_id == job.app_id))
            session.execute(
                delete(InstalledApp).where(InstalledApp.tenant_id == job.tenant_id, InstalledApp.app_id == job.app_id)
            )
            session.execute(delete(AppModelConfig).where(AppModelConfig.app_id == job.app_id))
            session.execute(delete(App).where(App.tenant_id == job.tenant_id, App.id == job.app_id))
            if tool_file_ids:
                session.execute(
                    delete(ToolFile).where(ToolFile.tenant_id == job.tenant_id, ToolFile.id.in_(tool_file_ids))
                )
            if upload_file_ids:
                session.execute(
                    delete(UploadFile).where(
                        UploadFile.tenant_id == job.tenant_id,
                        UploadFile.id.in_(upload_file_ids),
                    )
                )
