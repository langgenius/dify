from commands.vector_space import TidbStorageUsage, _estimated_storage_bytes


def test_estimated_storage_bytes_counts_row_and_column_vectors():
    assert _estimated_storage_bytes(point_count=10, dimension=1536, overhead_bytes=3584) == 10 * (1536 * 4 * 2 + 3584)


def test_tidb_storage_usage_total_bytes():
    usage = TidbStorageUsage(row_based_bytes=123, columnar_bytes=456)

    assert usage.total_bytes == 579
