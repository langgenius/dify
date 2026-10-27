"""Helper utilities for integration tests."""

import re


def generate_valid_password(fake, length: int = 12) -> str:
    """Generate a password that always satisfies the project's password validation rules.

    The password validation rule in ``api/libs/password.py`` requires passwords to
    contain **both letters and digits** with a minimum length of 8:

        ``^(?=.*[a-zA-Z])(?=.*\\d).{8,}$``

    ``Faker.password()`` does **not** guarantee that the generated password will
    contain both character types, which can cause intermittent test failures.

    This helper re-generates until the result is valid (typically first attempt).
    """
    for _ in range(100):
        pwd = fake.password(length=length)
        if re.search(r"[a-zA-Z]", pwd) and re.search(r"\d", pwd):
            return pwd
    # Fallback: should never be reached in practice
    return fake.password(length=max(length - 2, 6)) + "a1"
