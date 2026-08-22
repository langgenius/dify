import pytest
from werkzeug.exceptions import NotFound

from models.provider_ids import GenericProviderID


class TestGenericProviderID:
    def test_valid_three_segment_id(self) -> None:
        pid = GenericProviderID("org1/plug1/prov1")

        assert pid.organization == "org1"
        assert pid.plugin_name == "plug1"
        assert pid.provider_name == "prov1"
        assert pid.is_hardcoded is False
        assert pid.is_langgenius() is False
        assert pid.plugin_id == "org1/plug1"
        assert str(pid) == "org1/plug1/prov1"
        assert pid.to_string() == "org1/plug1/prov1"

    def test_single_segment_id_is_prefixed_with_langgenius(self) -> None:
        pid = GenericProviderID("google")

        assert pid.organization == "langgenius"
        assert pid.plugin_name == "google"
        assert pid.provider_name == "google"
        assert pid.is_langgenius() is True
        assert pid.plugin_id == "langgenius/google"

    def test_hardcoded_flag_is_preserved(self) -> None:
        pid = GenericProviderID("org1/plug1/prov1", is_hardcoded=True)
        assert pid.is_hardcoded is True

    def test_empty_value_raises_not_found(self) -> None:
        with pytest.raises(NotFound):
            GenericProviderID("")

    def test_invalid_value_raises_value_error(self) -> None:
        with pytest.raises(ValueError):
            GenericProviderID("Org1/Plug1/Prov1")  # uppercase

        with pytest.raises(ValueError):
            GenericProviderID("org/plug")  # only two segments, no fall-through match

        with pytest.raises(ValueError):
            GenericProviderID("org/plug/prov/extra")  # four segments

    def test_value_with_dot_raises_value_error(self) -> None:
        with pytest.raises(ValueError):
            GenericProviderID("org.name/plug/prov")

    def test_trailing_newline_in_three_segment_id_is_rejected(self) -> None:
        # Regression for #39880 (sibling of #39234 / #39548 / #39666 / #39730).
        # Without re.fullmatch, Python's `$` matches just before the trailing
        # newline, so the value is accepted and the newline survives into
        # self.organization.
        with pytest.raises(ValueError):
            GenericProviderID("org1/plug1/prov1\n")

        with pytest.raises(ValueError):
            GenericProviderID("org1/plug1/prov1\r")

        with pytest.raises(ValueError):
            GenericProviderID("org1/plug1/prov1\r\n")

    def test_trailing_newline_in_single_segment_id_is_rejected(self) -> None:
        # This is the actual bypass the old re.match had: "google\n" matched
        # the single-segment pattern (because `$` matched before `\n`), the
        # constructor rewrote it as "langgenius/google\n/google\n", and the
        # embedded newline survived into self.organization / plugin_id.
        with pytest.raises(ValueError):
            GenericProviderID("google\n")

        with pytest.raises(ValueError):
            GenericProviderID("google\r\n")
