from core.rag.graph.entities import DEFAULT_ENTITY_TYPES, GraphIndexSetting


class TestGraphIndexSettingNullTolerance:
    """The dataset-detail response serializes every graph-setting key, including
    ones the caller never touched, as an explicit ``null``. Saving the settings
    form round-trips that whole object back through the API and into storage
    verbatim, so ``GraphIndexSetting.model_validate`` must treat a stored
    ``null`` the same as a missing key for every field that has a default.
    """

    def test_explicit_null_falls_back_to_default_entity_types(self) -> None:
        setting = GraphIndexSetting.model_validate(
            {
                "enabled": True,
                "model_provider_name": "langgenius/gemini/google",
                "model_name": "gemini-3.5-flash",
                "entity_types": None,
                "max_depth": None,
            }
        )

        assert setting.entity_types == list(DEFAULT_ENTITY_TYPES)
        assert setting.max_depth == 2

    def test_missing_keys_still_default_normally(self) -> None:
        setting = GraphIndexSetting.model_validate({"enabled": True})

        assert setting.enabled is True
        assert setting.max_depth == 2
        assert setting.entity_types == list(DEFAULT_ENTITY_TYPES)

    def test_explicit_value_is_preserved_over_default(self) -> None:
        setting = GraphIndexSetting.model_validate({"enabled": True, "max_depth": 4})

        assert setting.max_depth == 4

    def test_all_numeric_and_list_fields_tolerate_null(self) -> None:
        setting = GraphIndexSetting.model_validate(
            {
                "enabled": True,
                "entity_types": None,
                "max_entities_per_chunk": None,
                "max_depth": None,
                "max_seed_entities": None,
                "max_neighbors_per_hop": None,
                "hop_decay": None,
            }
        )

        assert setting.max_entities_per_chunk == 16
        assert setting.max_seed_entities == 8
        assert setting.max_neighbors_per_hop == 64
        assert setting.hop_decay == 0.5
