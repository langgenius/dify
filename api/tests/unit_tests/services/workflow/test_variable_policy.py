"""Pure variable patch policy is shared by graph synchronization and variable edits."""

import pytest

from graphon.variables import StringVariable
from services.workflow.variable_policy import merge_environment_variable_patch


@pytest.mark.parametrize(
    ("upserts", "deletions", "error"),
    [
        ([StringVariable(id="", name="empty", value="")], [], "require an id"),
        (
            [StringVariable(id="same", name="one", value=""), StringVariable(id="same", name="two", value="")],
            [],
            "Duplicate patched",
        ),
        ([], ["same", "same"], "ids must be unique"),
        ([], [""], "must not be empty"),
        ([StringVariable(id="same", name="one", value="")], ["same"], "upserted and deleted"),
        ([StringVariable(id="new", name="kept", value="")], [], "names must be unique"),
    ],
)
def test_invalid_patch_does_not_mutate_input(upserts: list[StringVariable], deletions: list[str], error: str) -> None:
    current = [StringVariable(id="existing", name="kept", value="original")]
    with pytest.raises(ValueError, match=error):
        merge_environment_variable_patch(current, upserts, deletions)
    assert [(v.id, v.name, v.value) for v in current] == [("existing", "kept", "original")]
