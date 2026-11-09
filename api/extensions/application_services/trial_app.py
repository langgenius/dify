"""Composition of Trial App use cases."""

from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from repositories.trial_app_repository import TrialAppRepository
from services.trial_app_access_service import TrialAppAccessService
from services.trial_app_generation_adapters import AppGenerateServiceRuntime
from services.trial_app_generation_service import TrialAppGenerationService
from services.trial_app_usage import TrialAppUsageRecorder


@dataclass(frozen=True, slots=True)
class TrialAppServices:
    access: TrialAppAccessService
    generation: TrialAppGenerationService
    usage: TrialAppUsageRecorder


def build_trial_app_services(
    *, database_client: sessionmaker[Session], trial_apps: TrialAppRepository
) -> TrialAppServices:
    return TrialAppServices(
        access=TrialAppAccessService(apps=trial_apps),
        generation=TrialAppGenerationService(
            runtime=AppGenerateServiceRuntime(session_factory=database_client), usage=trial_apps
        ),
        usage=trial_apps,
    )
