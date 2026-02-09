import pytest

from core.app.entities.app_asset_entities import AppAssetFileTree, AppAssetNode


class TestAppAssetFileTreeRelativePath:
    @pytest.fixture
    def tree(self) -> AppAssetFileTree:
        tree = AppAssetFileTree()
        tree.add(AppAssetNode.create_folder("root", "root"))
        tree.add(AppAssetNode.create_folder("docs", "docs", "root"))
        tree.add(AppAssetNode.create_folder("sub", "sub", "docs"))
        tree.add(AppAssetNode.create_folder("deep", "deep", "sub"))
        tree.add(AppAssetNode.create_file("a_md", "a.md", "docs"))
        tree.add(AppAssetNode.create_file("b_md", "b.md", "docs"))
        tree.add(AppAssetNode.create_file("c_md", "c.md", "sub"))
        tree.add(AppAssetNode.create_file("d_md", "d.md", "deep"))
        tree.add(AppAssetNode.create_file("root_md", "root.md", "root"))
        return tree

    def test_same_directory_siblings(self, tree: AppAssetFileTree):
        a = tree.get("a_md")
        b = tree.get("b_md")
        assert a
        assert b
        assert tree.relative_path(a, b) == "./b.md"

    def test_same_file(self, tree: AppAssetFileTree):
        a = tree.get("a_md")
        assert a
        assert tree.relative_path(a, a) == "./a.md"

    def test_child_directory(self, tree: AppAssetFileTree):
        a = tree.get("a_md")
        c = tree.get("c_md")
        assert a
        assert c
        assert tree.relative_path(a, c) == "./sub/c.md"

    def test_parent_directory(self, tree: AppAssetFileTree):
        c = tree.get("c_md")
        a = tree.get("a_md")
        assert c
        assert a
        assert tree.relative_path(c, a) == "../a.md"

    def test_two_levels_up(self, tree: AppAssetFileTree):
        d = tree.get("d_md")
        a = tree.get("a_md")
        assert d
        assert a
        assert tree.relative_path(d, a) == "../../a.md"

    def test_cousin_same_level(self, tree: AppAssetFileTree):
        c = tree.get("c_md")
        b = tree.get("b_md")
        assert c
        assert b
        assert tree.relative_path(c, b) == "../b.md"

    def test_deep_to_shallow(self, tree: AppAssetFileTree):
        d = tree.get("d_md")
        root_md = tree.get("root_md")
        assert d
        assert root_md
        assert tree.relative_path(d, root_md) == "../../../root.md"

    def test_shallow_to_deep(self, tree: AppAssetFileTree):
        root_md = tree.get("root_md")
        d = tree.get("d_md")
        assert root_md
        assert d
        assert tree.relative_path(root_md, d) == "./docs/sub/deep/d.md"

    def test_reference_to_folder(self, tree: AppAssetFileTree):
        a = tree.get("a_md")
        sub = tree.get("sub")
        assert a
        assert sub
        assert tree.relative_path(a, sub) == "./sub"


class TestAppAssetFileTreeRelativePathRootLevel:
    @pytest.fixture
    def flat_tree(self) -> AppAssetFileTree:
        tree = AppAssetFileTree()
        tree.add(AppAssetNode.create_file("readme", "README.md"))
        tree.add(AppAssetNode.create_file("license", "LICENSE"))
        tree.add(AppAssetNode.create_folder("src", "src"))
        tree.add(AppAssetNode.create_file("main", "main.py", "src"))
        return tree

    def test_root_level_siblings(self, flat_tree: AppAssetFileTree):
        readme = flat_tree.get("readme")
        license_file = flat_tree.get("license")
        assert readme
        assert license_file
        assert flat_tree.relative_path(readme, license_file) == "./LICENSE"

    def test_root_to_nested(self, flat_tree: AppAssetFileTree):
        readme = flat_tree.get("readme")
        main = flat_tree.get("main")
        assert readme
        assert main
        assert flat_tree.relative_path(readme, main) == "./src/main.py"

    def test_nested_to_root(self, flat_tree: AppAssetFileTree):
        main = flat_tree.get("main")
        readme = flat_tree.get("readme")
        assert main
        assert readme
        assert flat_tree.relative_path(main, readme) == "../README.md"
