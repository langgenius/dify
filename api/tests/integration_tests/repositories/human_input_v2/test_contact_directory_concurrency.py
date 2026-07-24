"""PostgreSQL-only concurrency coverage for EE Contact uniqueness locking."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker

from core.human_input_v2.contact_directory import Contact, ContactDirectoryError, ContactRejectionCode
from core.human_input_v2.shared import AccountId, ContactId, UtcTimestamp
from extensions.ext_database import db
from models.human_input_v2 import HumanInputContact
from repositories.human_input_v2.contact_directory.repository import SQLAlchemyContactDirectoryRepository


def test_concurrent_organization_writes_serialize_on_dify_setup(flask_req_ctx, setup_account) -> None:
    if db.engine.dialect.name != "postgresql":
        pytest.skip("requires the CI PostgreSQL integration database")

    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    with session_maker.begin() as session:
        session.execute(
            sa.delete(HumanInputContact).where(
                HumanInputContact.tenant_id.is_(None),
                HumanInputContact.account_id == setup_account.id,
            )
        )
    barrier = Barrier(2)

    def write_contact(contact_id: str) -> Contact | ContactRejectionCode:
        repository = SQLAlchemyContactDirectoryRepository(session_maker)
        contact = Contact.organization_account(
            contact_id=ContactId(contact_id),
            account_id=AccountId(setup_account.id),
            name="Concurrent Account",
            email="concurrent@example.com",
            now=UtcTimestamp.now(),
        )
        barrier.wait()
        try:
            return repository.save_contact(contact)
        except ContactDirectoryError as error:
            return error.code

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(write_contact, ("concurrent-1", "concurrent-2")))

        assert sum(isinstance(result, Contact) for result in results) == 1
        assert results.count(ContactRejectionCode.CONFLICTING_IDENTITY) == 1
        with session_maker() as session:
            count = session.scalar(
                sa.select(sa.func.count(HumanInputContact.id)).where(
                    HumanInputContact.tenant_id.is_(None),
                    HumanInputContact.account_id == setup_account.id,
                )
            )
        assert count == 1
    finally:
        with session_maker.begin() as session:
            session.execute(
                sa.delete(HumanInputContact).where(
                    HumanInputContact.tenant_id.is_(None),
                    HumanInputContact.account_id == setup_account.id,
                )
            )
