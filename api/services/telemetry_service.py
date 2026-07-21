import logging
import platform
import uuid
from datetime import datetime
from typing import Literal

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from libs.datetime_utils import naive_utc_now
from models.model import DifySetup

logger = logging.getLogger(__name__)

TelemetryEvent = Literal["install", "heartbeat"]

SCHEMA_VERSION = 1


class CommunityTelemetryService:
    @classmethod
    def report_install(cls, *, session: Session) -> bool:
        setup = cls._get_setup(session)
        if setup is None:
            return False

        if setup.instance_id is None:
            setup.instance_id = str(uuid.uuid4())
            session.add(setup)
            session.commit()

        payload = cls._build_payload(setup, "install")
        if not cls._send_event(payload):
            return False

        setup.install_reported_at = naive_utc_now()
        session.add(setup)
        session.commit()
        return True

    @classmethod
    def report_heartbeat(cls, *, session: Session, now: datetime | None = None) -> bool:
        setup = cls._get_setup(session)
        if setup is None:
            return False

        if setup.instance_id is None:
            setup.instance_id = str(uuid.uuid4())
            session.add(setup)
            session.commit()

        now = now or naive_utc_now()
        if not cls._is_heartbeat_due(setup, now):
            return False

        if setup.install_reported_at is None:
            cls.report_install(session=session)

        payload = cls._build_payload(setup, "heartbeat")
        if not cls._send_event(payload):
            return False

        setup.last_heartbeat_at = now
        session.add(setup)
        session.commit()
        return True

    @classmethod
    def _get_setup(cls, session: Session) -> DifySetup | None:
        return session.scalar(select(DifySetup).order_by(DifySetup.setup_at.asc()).limit(1))

    @classmethod
    def _is_enabled(cls) -> bool:
        return (
            dify_config.EDITION == "SELF_HOSTED"
            and not dify_config.ENTERPRISE_ENABLED
            and not dify_config.DISABLE_TELEMETRY
            and not dify_config.DO_NOT_TRACK
            and not dify_config.CI
            and bool(dify_config.TELEMETRY_ENDPOINT)
        )

    @classmethod
    def _build_payload(cls, setup: DifySetup, event: TelemetryEvent) -> dict[str, str | int]:
        payload: dict[str, str | int] = {
            "event": event,
            "instance_id": setup.instance_id or "",
            "version": setup.version if event == "install" else dify_config.project.version,
            "edition": dify_config.EDITION,
            "deployment_type": "unknown",
            "schema_version": SCHEMA_VERSION,
            "os": cls._normalize_os(platform.system()),
            "arch": cls._normalize_arch(platform.machine()),
            "sent_at": cls._format_datetime(naive_utc_now()),
        }

        if event == "install":
            payload["installed_at"] = cls._format_datetime(setup.setup_at)

        return payload

    @classmethod
    def _send_event(cls, payload: dict[str, str | int]) -> bool:
        if not cls._is_enabled():
            return False

        endpoints = [dify_config.TELEMETRY_ENDPOINT]
        if dify_config.TELEMETRY_FALLBACK_ENDPOINT not in endpoints:
            endpoints.append(dify_config.TELEMETRY_FALLBACK_ENDPOINT)

        for endpoint in endpoints:
            if not endpoint:
                continue

            try:
                response = httpx.post(
                    endpoint,
                    json=payload,
                    timeout=dify_config.TELEMETRY_TIMEOUT_SECONDS,
                )
                response.raise_for_status()
                return True
            except httpx.RequestError:
                logger.debug("Failed to send community telemetry event to %s", endpoint, exc_info=True)
            except httpx.HTTPStatusError:
                logger.debug("Community telemetry endpoint returned an error: %s", endpoint, exc_info=True)
                return False

        return False

    @classmethod
    def _is_heartbeat_due(cls, setup: DifySetup, now: datetime) -> bool:
        if setup.instance_id is None:
            return False

        if setup.last_heartbeat_at is not None and setup.last_heartbeat_at.date() >= now.date():
            return False

        return True

    @staticmethod
    def _format_datetime(value: datetime) -> str:
        return value.replace(microsecond=0).isoformat() + "Z"

    @staticmethod
    def _normalize_os(value: str) -> str:
        os_name = value.lower()
        if os_name in {"linux", "darwin", "windows"}:
            return os_name
        return "unknown"

    @staticmethod
    def _normalize_arch(value: str) -> str:
        arch = value.lower()
        if arch in {"x86_64", "amd64"}:
            return "amd64"
        if arch in {"aarch64", "arm64"}:
            return "arm64"
        if arch.startswith("arm"):
            return "arm"
        if arch in {"i386", "i686", "x86"}:
            return "386"
        return "unknown"
