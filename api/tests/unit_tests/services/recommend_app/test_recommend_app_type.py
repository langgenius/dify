from services.recommend_app.recommend_app_type import RecommendAppType


def test_enum_values():
    assert RecommendAppType.REMOTE == "remote"
    assert RecommendAppType.BUILDIN == "builtin"
    assert RecommendAppType.DATABASE == "db"


def test_enum_membership():
    assert "remote" in RecommendAppType.__members__.values()
    assert "builtin" in RecommendAppType.__members__.values()
    assert "db" in RecommendAppType.__members__.values()


def test_enum_is_str():
    for member in RecommendAppType:
        assert isinstance(member, str)
