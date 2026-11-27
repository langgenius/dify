"""File chooser metadata uses the real byte-profile gate and saved-asset admission."""

from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from werkzeug.exceptions import Forbidden, NotFound

from controllers.console.agent.external_tests import ExternalAgentCapabilitiesApi
from models.account import TenantAccountJoin, TenantAccountRole
from models.external_agent import ExternalAgentConnectionRevision
from services.external_agents.file_profile import FILE_MODES, supported_input_file_types
from tests.unit_tests.controllers.console.agent.test_external_endpoint_contracts import (
    EndpointDomain,
    endpoint_domain,
    invoke,
    wire,
)

__all__ = ["endpoint_domain"]


def test_no_agent_keeps_the_existing_finite_mime_profile(endpoint_domain: EndpointDomain) -> None:
    value = wire(invoke(endpoint_domain, ExternalAgentCapabilitiesApi, "get"))
    assert value["input_file_modes"] == sorted(FILE_MODES)
    assert value["input_file_types"] == [
        {"media_type": "application/pdf", "extensions": [".pdf"]},
        {"media_type": "image/jpeg", "extensions": [".jpg", ".jpeg"]},
        {"media_type": "image/png", "extensions": [".png"]},
        {"media_type": "text/markdown", "extensions": [".md", ".markdown"]},
        {"media_type": "text/plain", "extensions": [".txt"]},
    ]


@pytest.mark.parametrize(
    ("defaults", "expected"),
    [
        (["TEXT/PLAIN; charset=utf-8", "image/jpg"], ["image/jpeg", "text/plain"]),
        (["text/*"], ["text/markdown", "text/plain"]),
        (["image/*"], ["image/jpeg", "image/png"]),
        (["*/*"], sorted(FILE_MODES)),
        (["application/msword"], []),
    ],
)
def test_agent_defaults_filter_types_without_accepting_skill_only_formats(
    endpoint_domain: EndpointDomain, defaults: list[str], expected: list[str]
) -> None:
    _, _, identifier, _, sessions = endpoint_domain
    with sessions.begin() as session:
        revision = session.scalars(select(ExternalAgentConnectionRevision)).one()
        revision.agent_card = {
            **revision.agent_card,
            "defaultInputModes": defaults,
            "skills": [{"id": "pdf-only", "inputModes": ["application/pdf", "application/msword"]}],
        }
    value = wire(invoke(endpoint_domain, ExternalAgentCapabilitiesApi, "get", query=f"?agent_id={identifier}"))
    assert value["input_file_modes"] == expected
    types = value["input_file_types"]
    assert isinstance(types, list)
    assert [wire(item)["media_type"] for item in types] == expected
    assert all(wire(item)["extensions"] for item in types)
    assert all(kind.media_type in expected for kind in supported_input_file_types(defaults))


def test_agent_profile_requires_existing_detail_access(endpoint_domain: EndpointDomain) -> None:
    _, context, identifier, _, sessions = endpoint_domain
    with sessions.begin() as session:
        member = session.scalars(
            select(TenantAccountJoin).where(TenantAccountJoin.account_id == context.account_id)
        ).one()
        member.role = TenantAccountRole.NORMAL
    assert wire(invoke(endpoint_domain, ExternalAgentCapabilitiesApi, "get"))["input_file_types"]
    with pytest.raises(Forbidden):
        invoke(endpoint_domain, ExternalAgentCapabilitiesApi, "get", query=f"?agent_id={identifier}")


def test_unknown_or_malformed_agent_does_not_fall_back_to_global_types(endpoint_domain: EndpointDomain) -> None:
    with pytest.raises(NotFound):
        invoke(endpoint_domain, ExternalAgentCapabilitiesApi, "get", query=f"?agent_id={uuid4()}")
    with pytest.raises(ValidationError):
        invoke(endpoint_domain, ExternalAgentCapabilitiesApi, "get", query="?agent_id=not-a-uuid")
