from unittest.mock import MagicMock, Mock, patch

from services.metadata_service import MetadataService


class TestMetadataServicePipelineGuard:
    def test_collect_referenced_metadata_ids_from_nested_payload(self):
        payload = {
            "metadata_filtering_conditions": {
                "conditions": [
                    {"id": "cond-1", "metadata_id": "meta-1"},
                    {"id": "cond-2", "group": {"metadata_id": "meta-2"}},
                ],
            },
            "node": {
                "data": {
                    "doc_metadata": [
                        {"metadata_id": "meta-3"},
                    ],
                },
            },
        }

        referenced_ids: set[str] = set()
        MetadataService._collect_referenced_metadata_ids(payload, referenced_ids)

        # All metadata_ids found in the payload are collected (no candidate filter)
        assert referenced_ids == {"meta-1", "meta-2", "meta-3"}

    def test_collect_referenced_metadata_ids_list_root(self):
        payload = [
            {"metadata_id": "meta-a"},
            {"nested": {"metadata_id": "meta-b"}},
            {"no_metadata": True},
        ]

        referenced_ids: set[str] = set()
        MetadataService._collect_referenced_metadata_ids(payload, referenced_ids)

        assert referenced_ids == {"meta-a", "meta-b"}

    def test_get_referenced_metadata_ids_filters_by_candidate_set(self):
        """Only IDs that are both referenced AND in metadata_ids are returned."""
        with (
            patch.object(
                MetadataService,
                "_scan_all_referenced_metadata_ids",
                return_value={"meta-1", "meta-2", "meta-3"},
            ),
            patch("services.metadata_service.redis_client") as mock_redis,
        ):
            mock_redis.get.return_value = None  # cache miss

            result = MetadataService._get_referenced_metadata_ids("tenant-1", {"meta-2", "meta-9"})

        assert result == {"meta-2"}

    def test_get_referenced_metadata_ids_uses_cache(self):
        """Cache hit returns the intersection without calling the DB scanner."""
        import json

        cached_ids = ["meta-1", "meta-2"]
        with (
            patch("services.metadata_service.redis_client") as mock_redis,
            patch.object(MetadataService, "_scan_all_referenced_metadata_ids") as mock_scan,
        ):
            mock_redis.get.return_value = json.dumps(cached_ids).encode()

            result = MetadataService._get_referenced_metadata_ids("tenant-1", {"meta-2", "meta-9"})

        mock_scan.assert_not_called()
        assert result == {"meta-2"}

    def test_get_referenced_metadata_ids_bypass_cache_skips_redis(self):
        """bypass_cache=True skips the Redis read and always scans the DB."""
        with (
            patch("services.metadata_service.redis_client") as mock_redis,
            patch.object(
                MetadataService,
                "_scan_all_referenced_metadata_ids",
                return_value={"meta-1"},
            ) as mock_scan,
        ):
            result = MetadataService._get_referenced_metadata_ids("tenant-1", {"meta-1"}, bypass_cache=True)

        mock_redis.get.assert_not_called()
        mock_scan.assert_called_once_with("tenant-1")
        assert result == {"meta-1"}

    def test_get_dataset_metadatas_marks_pipeline_references(self):
        dataset = Mock()
        dataset.id = "dataset-1"
        dataset.tenant_id = "tenant-1"
        dataset.built_in_field_enabled = False
        dataset.doc_metadata = [
            {"id": "meta-1", "name": "author", "type": "string"},
            {"id": "meta-2", "name": "category", "type": "string"},
        ]

        query_mock = MagicMock()
        query_mock.filter_by.return_value = query_mock
        query_mock.count.side_effect = [2, 5]

        with (
            patch.object(MetadataService, "_get_referenced_metadata_ids", return_value={"meta-2"}),
            patch("services.metadata_service.db.session.query", return_value=query_mock),
        ):
            result = MetadataService.get_dataset_metadatas(dataset)

        assert result == {
            "doc_metadata": [
                {
                    "id": "meta-1",
                    "name": "author",
                    "type": "string",
                    "count": 2,
                    "is_referenced_by_pipeline": False,
                },
                {
                    "id": "meta-2",
                    "name": "category",
                    "type": "string",
                    "count": 5,
                    "is_referenced_by_pipeline": True,
                },
            ],
            "built_in_field_enabled": False,
        }
