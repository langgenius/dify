"""add uuidv7 function in SQL

Revision ID: 1c9ba48be8e4
Revises: 58eb7bdb93fe
Create Date: 2025-07-02 23:32:38.484499

"""

"""
The functions in this files comes from https://github.com/dverite/postgres-uuidv7-sql/, with minor modifications.

LICENSE:

# Copyright and License

Copyright (c) 2024, Daniel Vérité

Permission to use, copy, modify, and distribute this software and its documentation for any purpose, without fee, and without a written agreement is hereby granted, provided that the above copyright notice and this paragraph and the following two paragraphs appear in all copies.

In no event shall Daniel Vérité be liable to any party for direct, indirect, special, incidental, or consequential damages, including lost profits, arising out of the use of this software and its documentation, even if Daniel Vérité has been advised of the possibility of such damage.

Daniel Vérité specifically disclaims any warranties, including, but not limited to, the implied warranties of merchantability and fitness for a particular purpose. The software provided hereunder is on an "AS IS" basis, and Daniel Vérité has no obligations to provide maintenance, support, updates, enhancements, or modifications.
"""

from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '1c9ba48be8e4'
down_revision = '58eb7bdb93fe'
branch_labels: None = None
depends_on: None = None


def upgrade():
    # This implementation differs slightly from the original uuidv7 function in
    # https://github.com/dverite/postgres-uuidv7-sql/.
    # The ability to specify source timestamp has been removed because its type signature is incompatible with
    # PostgreSQL 18's `uuidv7` function. This capability is rarely needed in practice, as IDs can be
    # generated and controlled within the application layer.
    op.execute(sa.text(r"""
/* Main function to generate a uuidv7 value with millisecond precision */
CREATE FUNCTION uuidv7() RETURNS uuid
AS
$$
    -- Replace the first 48 bits of a uuidv4 with the current
    -- number of milliseconds since 1970-01-01 UTC
    -- and set the "ver" field to 7 by setting additional bits
SELECT encode(
               set_bit(
                       set_bit(
                               overlay(uuid_send(gen_random_uuid()) placing
                                       substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from
                                                 3)
                                       from 1 for 6),
                               52, 1),
                       53, 1), 'hex')::uuid;
$$ LANGUAGE SQL VOLATILE PARALLEL SAFE;

COMMENT ON FUNCTION uuidv7 IS
    'Generate a uuid-v7 value with a 48-bit timestamp (millisecond precision) and 74 bits of randomness';
"""))

    op.execute(sa.text(r"""
CREATE FUNCTION uuidv7_boundary(timestamptz) RETURNS uuid
AS
$$
    /* uuid fields: version=0b0111, variant=0b10 */
SELECT encode(
               overlay('\x00000000000070008000000000000000'::bytea
                       placing substring(int8send(floor(extract(epoch from $1) * 1000)::bigint) from 3)
                       from 1 for 6),
               'hex')::uuid;
$$ LANGUAGE SQL STABLE STRICT PARALLEL SAFE;

COMMENT ON FUNCTION uuidv7_boundary(timestamptz) IS
    'Generate a non-random uuidv7 with the given timestamp (first 48 bits) and all random bits to 0. As the smallest possible uuidv7 for that timestamp, it may be used as a boundary for partitions.';
"""
))


def downgrade():
    op.execute(sa.text("DROP FUNCTION uuidv7"))
    op.execute(sa.text("DROP FUNCTION uuidv7_boundary"))
