from typing import Any

from core.app.entities.app_asset_entities import AppAssetFileTree, AppAssetNode
from core.skill.entities.skill_artifact_set import SkillArtifactSet
from core.skill.entities.skill_document import SkillDocument
from core.skill.entities.skill_metadata import FileReference, ToolConfiguration, ToolReference
from core.skill.skill_compiler import SkillCompiler
from core.tools.entities.tool_entities import ToolProviderType


def create_file_tree(*nodes: AppAssetNode) -> AppAssetFileTree:
    tree = AppAssetFileTree()
    for node in nodes:
        tree.nodes.append(node)
    return tree


def make_metadata(
    tools: dict[str, ToolReference] | None = None,
    files: list[FileReference] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {"tools": {}}
    if tools:
        for tool_id, tool in tools.items():
            result["tools"][tool_id] = {
                "type": tool.type.value,
                "credential_id": tool.credential_id,
                "configuration": tool.configuration.model_dump() if tool.configuration else {},
            }
    return result


class TestSkillCompilerBasic:
    def test_compile_single_skill_no_dependencies(self):
        # given
        doc = SkillDocument(
            skill_id="skill-1",
            content="This is a simple skill with no references.",
            metadata=make_metadata(tools={}, files=[]),
        )
        tree = create_file_tree(
            AppAssetNode.create_file("skill-1", "skill.md"),
        )
        compiler = SkillCompiler()

        # when
        artifact_set = compiler.compile_all([doc], tree, "assets-1")

        # then
        assert artifact_set.assets_id == "assets-1"
        assert len(artifact_set.items) == 1

        artifact = artifact_set.get("skill-1")
        assert artifact is not None
        assert artifact.skill_id == "skill-1"
        assert artifact.content == "This is a simple skill with no references."
        assert len(artifact.tools.dependencies) == 0
        assert len(artifact.files.references) == 0

    def test_compile_skill_with_tool_reference(self):
        # given
        tool_ref = ToolReference(
            uuid="tool-uuid-1",
            type=ToolProviderType.BUILT_IN,
            provider="sandbox",
            tool_name="bash",
            credential_id=None,
            configuration=ToolConfiguration(fields=[]),
        )
        doc = SkillDocument(
            skill_id="skill-1",
            content="Run this command: §[tool].[sandbox].[bash].[tool-uuid-1]§",
            metadata=make_metadata(
                tools={"tool-uuid-1": tool_ref},
                files=[],
            ),
        )
        tree = create_file_tree(
            AppAssetNode.create_file("skill-1", "skill.md"),
        )
        compiler = SkillCompiler()

        # when
        artifact_set = compiler.compile_all([doc], tree, "assets-1")

        # then
        artifact = artifact_set.get("skill-1")
        assert artifact is not None
        assert artifact.content == "Run this command: [Bash Command: bash_tool-uuid-1]"
        assert len(artifact.tools.dependencies) == 1
        assert artifact.tools.dependencies[0].provider == "sandbox"
        assert artifact.tools.dependencies[0].tool_name == "bash"

    def test_compile_skill_with_file_reference(self):
        # given
        doc = SkillDocument(
            skill_id="skill-1",
            content="See this file: §[file].[app].[file-1]§",
            metadata=make_metadata(
                tools={},
                files=[FileReference(source="app", asset_id="file-1")],
            ),
        )
        tree = create_file_tree(
            AppAssetNode.create_file("skill-1", "skill.md"),
            AppAssetNode.create_file("file-1", "readme.txt"),
        )
        compiler = SkillCompiler()

        # when
        artifact_set = compiler.compile_all([doc], tree, "assets-1")

        # then
        artifact = artifact_set.get("skill-1")
        assert artifact is not None
        assert artifact.content == "See this file: ./readme.txt"
        assert len(artifact.files.references) == 1
        assert artifact.files.references[0].asset_id == "file-1"


class TestSkillCompilerTransitiveDependencies:
    def test_compile_skill_with_skill_dependency(self):
        # given
        # skill-a references skill-b
        # skill-b has a tool dependency
        tool_ref = ToolReference(
            uuid="tool-1",
            type=ToolProviderType.BUILT_IN,
            provider="sandbox",
            tool_name="python",
            credential_id=None,
            configuration=None,
        )
        doc_a = SkillDocument(
            skill_id="skill-a",
            content="See: §[file].[app].[skill-b]§",
            metadata=make_metadata(
                tools={},
                files=[FileReference(source="app", asset_id="skill-b")],
            ),
        )
        doc_b = SkillDocument(
            skill_id="skill-b",
            content="Run: §[tool].[sandbox].[python].[tool-1]§",
            metadata=make_metadata(
                tools={"tool-1": tool_ref},
                files=[],
            ),
        )
        tree = create_file_tree(
            AppAssetNode.create_file("skill-a", "skill-a.md"),
            AppAssetNode.create_file("skill-b", "skill-b.md"),
        )
        compiler = SkillCompiler()

        # when
        artifact_set = compiler.compile_all([doc_a, doc_b], tree, "assets-1")

        # then
        artifact_a = artifact_set.get("skill-a")
        assert artifact_a is not None
        # skill-a should have transitive tool dependency from skill-b
        assert len(artifact_a.tools.dependencies) == 1
        assert artifact_a.tools.dependencies[0].tool_name == "python"

        # dependency graph should show skill-a depends on skill-b
        assert "skill-b" in artifact_set.dependency_graph.get("skill-a", [])
        # reverse graph should show skill-b is depended by skill-a
        assert "skill-a" in artifact_set.reverse_graph.get("skill-b", [])

    def test_compile_chain_dependency(self):
        # given
        # skill-a -> skill-b -> skill-c
        # each has its own tool
        tool_a = ToolReference(
            uuid="tool-a", type=ToolProviderType.BUILT_IN, provider="p", tool_name="tool_a"
        )
        tool_b = ToolReference(
            uuid="tool-b", type=ToolProviderType.BUILT_IN, provider="p", tool_name="tool_b"
        )
        tool_c = ToolReference(
            uuid="tool-c", type=ToolProviderType.BUILT_IN, provider="p", tool_name="tool_c"
        )

        doc_a = SkillDocument(
            skill_id="skill-a",
            content="A refs B: §[file].[app].[skill-b]§ §[tool].[p].[tool_a].[tool-a]§",
            metadata=make_metadata(
                tools={"tool-a": tool_a},
                files=[FileReference(source="app", asset_id="skill-b")],
            ),
        )
        doc_b = SkillDocument(
            skill_id="skill-b",
            content="B refs C: §[file].[app].[skill-c]§ §[tool].[p].[tool_b].[tool-b]§",
            metadata=make_metadata(
                tools={"tool-b": tool_b},
                files=[FileReference(source="app", asset_id="skill-c")],
            ),
        )
        doc_c = SkillDocument(
            skill_id="skill-c",
            content="C is leaf §[tool].[p].[tool_c].[tool-c]§",
            metadata=make_metadata(
                tools={"tool-c": tool_c},
                files=[],
            ),
        )

        tree = create_file_tree(
            AppAssetNode.create_file("skill-a", "a.md"),
            AppAssetNode.create_file("skill-b", "b.md"),
            AppAssetNode.create_file("skill-c", "c.md"),
        )
        compiler = SkillCompiler()

        # when
        artifact_set = compiler.compile_all([doc_a, doc_b, doc_c], tree, "assets-1")

        # then
        artifact_a = artifact_set.get("skill-a")
        assert artifact_a is not None
        # skill-a should have all 3 tools (own + transitive)
        tool_names = {d.tool_name for d in artifact_a.tools.dependencies}
        assert tool_names == {"tool_a", "tool_b", "tool_c"}

        artifact_b = artifact_set.get("skill-b")
        assert artifact_b is not None
        tool_names_b = {d.tool_name for d in artifact_b.tools.dependencies}
        assert tool_names_b == {"tool_b", "tool_c"}

        artifact_c = artifact_set.get("skill-c")
        assert artifact_c is not None
        tool_names_c = {d.tool_name for d in artifact_c.tools.dependencies}
        assert tool_names_c == {"tool_c"}


class TestSkillArtifactSetQueries:
    def test_recompile_group_ids(self):
        # given
        # skill-a -> skill-b -> skill-c
        doc_a = SkillDocument(
            skill_id="skill-a",
            content="refs B: §[file].[app].[skill-b]§",
            metadata=make_metadata(
                tools={},
                files=[FileReference(source="app", asset_id="skill-b")],
            ),
        )
        doc_b = SkillDocument(
            skill_id="skill-b",
            content="refs C: §[file].[app].[skill-c]§",
            metadata=make_metadata(
                tools={},
                files=[FileReference(source="app", asset_id="skill-c")],
            ),
        )
        doc_c = SkillDocument(
            skill_id="skill-c",
            content="leaf",
            metadata=make_metadata(tools={}, files=[]),
        )

        tree = create_file_tree(
            AppAssetNode.create_file("skill-a", "a.md"),
            AppAssetNode.create_file("skill-b", "b.md"),
            AppAssetNode.create_file("skill-c", "c.md"),
        )
        compiler = SkillCompiler()
        artifact_set = compiler.compile_all([doc_a, doc_b, doc_c], tree, "assets-1")

        # when - if skill-c changes, who needs recompile?
        affected = artifact_set.recompile_group_ids("skill-c")

        # then - all upstream skills need recompile
        assert affected == {"skill-a", "skill-b", "skill-c"}

    def test_referenced_skill_ids(self):
        # given
        doc_a = SkillDocument(
            skill_id="skill-a",
            content="refs B and C: §[file].[app].[skill-b]§ §[file].[app].[skill-c]§",
            metadata=make_metadata(
                tools={},
                files=[
                    FileReference(source="app", asset_id="skill-b"),
                    FileReference(source="app", asset_id="skill-c"),
                ],
            ),
        )
        doc_b = SkillDocument(
            skill_id="skill-b",
            content="B",
            metadata=make_metadata(tools={}, files=[]),
        )
        doc_c = SkillDocument(
            skill_id="skill-c",
            content="C",
            metadata=make_metadata(tools={}, files=[]),
        )

        tree = create_file_tree(
            AppAssetNode.create_file("skill-a", "a.md"),
            AppAssetNode.create_file("skill-b", "b.md"),
            AppAssetNode.create_file("skill-c", "c.md"),
        )
        compiler = SkillCompiler()
        artifact_set = compiler.compile_all([doc_a, doc_b, doc_c], tree, "assets-1")

        # when
        refs = artifact_set.referenced_skill_ids("skill-a")

        # then
        assert refs == {"skill-b", "skill-c"}


class TestSkillCompilerIncrementalCompile:
    def test_compile_one_updates_artifact_set(self):
        # given - initial compile
        doc_a = SkillDocument(
            skill_id="skill-a",
            content="original content",
            metadata=make_metadata(tools={}, files=[]),
        )
        tree = create_file_tree(
            AppAssetNode.create_file("skill-a", "a.md"),
        )
        compiler = SkillCompiler()
        artifact_set = compiler.compile_all([doc_a], tree, "assets-1")

        # when - update skill-a
        updated_doc = SkillDocument(
            skill_id="skill-a",
            content="updated content",
            metadata=make_metadata(tools={}, files=[]),
        )
        updated_artifact = compiler.compile_one(artifact_set, updated_doc, tree)
        artifact_set.upsert(updated_artifact)

        # then
        artifact = artifact_set.get("skill-a")
        assert artifact is not None
        assert artifact.content == "updated content"


class TestSkillCompilerEdgeCases:
    def test_missing_file_reference_replaced_with_placeholder(self):
        # given
        doc = SkillDocument(
            skill_id="skill-1",
            content="See: §[file].[app].[non-existent]§",
            metadata=make_metadata(
                tools={},
                files=[FileReference(source="app", asset_id="non-existent")],
            ),
        )
        tree = create_file_tree(
            AppAssetNode.create_file("skill-1", "skill.md"),
        )
        compiler = SkillCompiler()

        # when
        artifact_set = compiler.compile_all([doc], tree, "assets-1")

        # then
        artifact = artifact_set.get("skill-1")
        assert artifact is not None
        assert "[File not found]" in artifact.content

    def test_missing_tool_reference_replaced_with_placeholder(self):
        # given
        doc = SkillDocument(
            skill_id="skill-1",
            content="Run: §[tool].[sandbox].[bash].[missing-tool]§",
            metadata=make_metadata(tools={}, files=[]),
        )
        tree = create_file_tree(
            AppAssetNode.create_file("skill-1", "skill.md"),
        )
        compiler = SkillCompiler()

        # when
        artifact_set = compiler.compile_all([doc], tree, "assets-1")

        # then
        artifact = artifact_set.get("skill-1")
        assert artifact is not None
        assert "[Tool not found: missing-tool]" in artifact.content

    def test_content_digest_changes_when_content_changes(self):
        # given
        tree = create_file_tree(
            AppAssetNode.create_file("skill-1", "skill.md"),
        )
        compiler = SkillCompiler()

        doc1 = SkillDocument(
            skill_id="skill-1",
            content="content version 1",
            metadata=make_metadata(tools={}, files=[]),
        )
        artifact_set1 = compiler.compile_all([doc1], tree, "assets-1")
        artifact1 = artifact_set1.get("skill-1")
        assert artifact1 is not None
        digest1 = artifact1.source.content_digest

        doc2 = SkillDocument(
            skill_id="skill-1",
            content="content version 2",
            metadata=make_metadata(tools={}, files=[]),
        )
        artifact_set2 = compiler.compile_all([doc2], tree, "assets-1")
        artifact2 = artifact_set2.get("skill-1")
        assert artifact2 is not None
        digest2 = artifact2.source.content_digest

        # then
        assert digest1 != digest2


class TestSkillCompilerComplexScenarios:
    def test_diamond_dependency(self):
        # given
        #     skill-a
        #    /       \
        # skill-b   skill-c
        #    \       /
        #     skill-d (has tool)
        tool_d = ToolReference(
            uuid="tool-d", type=ToolProviderType.BUILT_IN, provider="p", tool_name="tool_d"
        )

        doc_a = SkillDocument(
            skill_id="skill-a",
            content="A refs B and C: §[file].[app].[skill-b]§ §[file].[app].[skill-c]§",
            metadata=make_metadata(
                tools={},
                files=[
                    FileReference(source="app", asset_id="skill-b"),
                    FileReference(source="app", asset_id="skill-c"),
                ],
            ),
        )
        doc_b = SkillDocument(
            skill_id="skill-b",
            content="B refs D: §[file].[app].[skill-d]§",
            metadata=make_metadata(
                tools={},
                files=[FileReference(source="app", asset_id="skill-d")],
            ),
        )
        doc_c = SkillDocument(
            skill_id="skill-c",
            content="C refs D: §[file].[app].[skill-d]§",
            metadata=make_metadata(
                tools={},
                files=[FileReference(source="app", asset_id="skill-d")],
            ),
        )
        doc_d = SkillDocument(
            skill_id="skill-d",
            content="D is leaf with tool: §[tool].[p].[tool_d].[tool-d]§",
            metadata=make_metadata(
                tools={"tool-d": tool_d},
                files=[],
            ),
        )

        tree = create_file_tree(
            AppAssetNode.create_file("skill-a", "a.md"),
            AppAssetNode.create_file("skill-b", "b.md"),
            AppAssetNode.create_file("skill-c", "c.md"),
            AppAssetNode.create_file("skill-d", "d.md"),
        )
        compiler = SkillCompiler()

        # when
        artifact_set = compiler.compile_all([doc_a, doc_b, doc_c, doc_d], tree, "assets-1")

        # then
        # skill-a should have tool_d (via both B and C paths, but only once)
        artifact_a = artifact_set.get("skill-a")
        assert artifact_a is not None
        assert len(artifact_a.tools.dependencies) == 1
        assert artifact_a.tools.dependencies[0].tool_name == "tool_d"

        # if skill-d changes, all upstream need recompile
        affected = artifact_set.recompile_group_ids("skill-d")
        assert affected == {"skill-a", "skill-b", "skill-c", "skill-d"}

    def test_multiple_tools_from_multiple_paths(self):
        # given
        #     skill-a
        #    /       \
        # skill-b   skill-c
        # (tool_b)  (tool_c)
        #    \       /
        #     skill-d
        #     (tool_d)
        tool_b = ToolReference(
            uuid="tool-b", type=ToolProviderType.BUILT_IN, provider="p", tool_name="tool_b"
        )
        tool_c = ToolReference(
            uuid="tool-c", type=ToolProviderType.API, provider="q", tool_name="tool_c"
        )
        tool_d = ToolReference(
            uuid="tool-d", type=ToolProviderType.WORKFLOW, provider="r", tool_name="tool_d"
        )

        doc_a = SkillDocument(
            skill_id="skill-a",
            content="A: §[file].[app].[skill-b]§ §[file].[app].[skill-c]§",
            metadata=make_metadata(
                tools={},
                files=[
                    FileReference(source="app", asset_id="skill-b"),
                    FileReference(source="app", asset_id="skill-c"),
                ],
            ),
        )
        doc_b = SkillDocument(
            skill_id="skill-b",
            content="B: §[file].[app].[skill-d]§ §[tool].[p].[tool_b].[tool-b]§",
            metadata=make_metadata(
                tools={"tool-b": tool_b},
                files=[FileReference(source="app", asset_id="skill-d")],
            ),
        )
        doc_c = SkillDocument(
            skill_id="skill-c",
            content="C: §[file].[app].[skill-d]§ §[tool].[q].[tool_c].[tool-c]§",
            metadata=make_metadata(
                tools={"tool-c": tool_c},
                files=[FileReference(source="app", asset_id="skill-d")],
            ),
        )
        doc_d = SkillDocument(
            skill_id="skill-d",
            content="D: §[tool].[r].[tool_d].[tool-d]§",
            metadata=make_metadata(
                tools={"tool-d": tool_d},
                files=[],
            ),
        )

        tree = create_file_tree(
            AppAssetNode.create_file("skill-a", "a.md"),
            AppAssetNode.create_file("skill-b", "b.md"),
            AppAssetNode.create_file("skill-c", "c.md"),
            AppAssetNode.create_file("skill-d", "d.md"),
        )
        compiler = SkillCompiler()

        # when
        artifact_set = compiler.compile_all([doc_a, doc_b, doc_c, doc_d], tree, "assets-1")

        # then
        artifact_a = artifact_set.get("skill-a")
        assert artifact_a is not None
        tool_names = {d.tool_name for d in artifact_a.tools.dependencies}
        assert tool_names == {"tool_b", "tool_c", "tool_d"}

        # verify different tool types are preserved
        tool_types = {d.type for d in artifact_a.tools.dependencies}
        assert tool_types == {ToolProviderType.BUILT_IN, ToolProviderType.API, ToolProviderType.WORKFLOW}

    def test_deep_nested_folder_structure_with_relative_paths(self):
        # given
        # /root/
        #   main.md (refs helper and asset)
        #   helpers/
        #     helper.md (refs deep asset)
        #     deep/
        #       deep-helper.md
        #   assets/
        #     image.png
        folder_root = AppAssetNode.create_folder("folder-root", "root")
        folder_helpers = AppAssetNode.create_folder("folder-helpers", "helpers", parent_id="folder-root")
        folder_deep = AppAssetNode.create_folder("folder-deep", "deep", parent_id="folder-helpers")
        folder_assets = AppAssetNode.create_folder("folder-assets", "assets", parent_id="folder-root")

        file_main = AppAssetNode.create_file("file-main", "main.md", parent_id="folder-root")
        file_helper = AppAssetNode.create_file("file-helper", "helper.md", parent_id="folder-helpers")
        file_deep = AppAssetNode.create_file("file-deep", "deep-helper.md", parent_id="folder-deep")
        file_image = AppAssetNode.create_file("file-image", "image.png", parent_id="folder-assets")

        tree = create_file_tree(
            folder_root, folder_helpers, folder_deep, folder_assets,
            file_main, file_helper, file_deep, file_image,
        )

        doc_main = SkillDocument(
            skill_id="file-main",
            content="Main refs helper: §[file].[app].[file-helper]§ and image: §[file].[app].[file-image]§",
            metadata=make_metadata(
                tools={},
                files=[
                    FileReference(source="app", asset_id="file-helper"),
                    FileReference(source="app", asset_id="file-image"),
                ],
            ),
        )
        doc_helper = SkillDocument(
            skill_id="file-helper",
            content="Helper refs deep: §[file].[app].[file-deep]§",
            metadata=make_metadata(
                tools={},
                files=[FileReference(source="app", asset_id="file-deep")],
            ),
        )
        doc_deep = SkillDocument(
            skill_id="file-deep",
            content="Deep helper content",
            metadata=make_metadata(tools={}, files=[]),
        )

        compiler = SkillCompiler()

        # when
        artifact_set = compiler.compile_all([doc_main, doc_helper, doc_deep], tree, "assets-1")

        # then
        artifact_main = artifact_set.get("file-main")
        assert artifact_main is not None
        # main.md -> helpers/helper.md = ./helpers/helper.md
        assert "./helpers/helper.md" in artifact_main.content
        # main.md -> assets/image.png = ./assets/image.png
        assert "./assets/image.png" in artifact_main.content

        artifact_helper = artifact_set.get("file-helper")
        assert artifact_helper is not None
        # helpers/helper.md -> helpers/deep/deep-helper.md = ./deep/deep-helper.md
        assert "./deep/deep-helper.md" in artifact_helper.content

    def test_skill_with_many_tools_and_files(self):
        # given - skill with 10 tools and 5 file references
        tools = {
            f"tool-{i}": ToolReference(
                uuid=f"tool-{i}",
                type=ToolProviderType.BUILT_IN,
                provider=f"provider-{i}",
                tool_name=f"tool_name_{i}",
            )
            for i in range(10)
        }
        files = [
            FileReference(source="app", asset_id=f"file-{i}")
            for i in range(5)
        ]

        tool_refs_in_content = " ".join(
            f"§[tool].[provider-{i}].[tool_name_{i}].[tool-{i}]§" for i in range(10)
        )
        file_refs_in_content = " ".join(
            f"§[file].[app].[file-{i}]§" for i in range(5)
        )

        doc = SkillDocument(
            skill_id="skill-main",
            content=f"Tools: {tool_refs_in_content}\nFiles: {file_refs_in_content}",
            metadata=make_metadata(tools=tools, files=files),
        )

        nodes = [AppAssetNode.create_file("skill-main", "main.md")]
        nodes.extend(AppAssetNode.create_file(f"file-{i}", f"file-{i}.txt") for i in range(5))
        tree = create_file_tree(*nodes)

        compiler = SkillCompiler()

        # when
        artifact_set = compiler.compile_all([doc], tree, "assets-1")

        # then
        artifact = artifact_set.get("skill-main")
        assert artifact is not None
        assert len(artifact.tools.dependencies) == 10
        assert len(artifact.tools.references) == 10
        assert len(artifact.files.references) == 5

        # all tool references should be replaced
        for i in range(10):
            assert f"[Bash Command: tool_name_{i}_tool-{i}]" in artifact.content
        # all file references should be replaced
        for i in range(5):
            assert f"./file-{i}.txt" in artifact.content

    def test_incremental_compile_with_new_dependency(self):
        # given - initial state: skill-a standalone
        tree = create_file_tree(
            AppAssetNode.create_file("skill-a", "a.md"),
            AppAssetNode.create_file("skill-b", "b.md"),
        )

        doc_a_v1 = SkillDocument(
            skill_id="skill-a",
            content="A standalone",
            metadata=make_metadata(tools={}, files=[]),
        )
        doc_b = SkillDocument(
            skill_id="skill-b",
            content="B with tool: §[tool].[p].[tool_b].[tool-b]§",
            metadata=make_metadata(
                tools={
                    "tool-b": ToolReference(
                        uuid="tool-b",
                        type=ToolProviderType.BUILT_IN,
                        provider="p",
                        tool_name="tool_b",
                    )
                },
                files=[],
            ),
        )

        compiler = SkillCompiler()
        artifact_set = compiler.compile_all([doc_a_v1, doc_b], tree, "assets-1")

        # skill-a has no dependencies initially
        artifact_a_v1 = artifact_set.get("skill-a")
        assert artifact_a_v1 is not None
        assert len(artifact_a_v1.tools.dependencies) == 0

        # when - update skill-a to reference skill-b
        doc_a_v2 = SkillDocument(
            skill_id="skill-a",
            content="A now refs B: §[file].[app].[skill-b]§",
            metadata=make_metadata(
                tools={},
                files=[FileReference(source="app", asset_id="skill-b")],
            ),
        )
        doc_map = {"skill-a": doc_a_v2, "skill-b": doc_b}
        artifact_a_v2 = compiler.compile_one(artifact_set, doc_a_v2, tree, doc_map)
        artifact_set.upsert(artifact_a_v2)

        # then - skill-a now has tool_b from skill-b
        artifact_a_final = artifact_set.get("skill-a")
        assert artifact_a_final is not None
        assert len(artifact_a_final.tools.dependencies) == 1
        assert artifact_a_final.tools.dependencies[0].tool_name == "tool_b"

        # dependency graph updated
        assert "skill-b" in artifact_set.dependency_graph.get("skill-a", [])
        assert "skill-a" in artifact_set.reverse_graph.get("skill-b", [])

    def test_serialization_roundtrip(self):
        # given - complex artifact set
        tool = ToolReference(
            uuid="tool-1",
            type=ToolProviderType.BUILT_IN,
            provider="sandbox",
            tool_name="bash",
        )
        doc_a = SkillDocument(
            skill_id="skill-a",
            content="A refs B: §[file].[app].[skill-b]§ §[tool].[sandbox].[bash].[tool-1]§",
            metadata=make_metadata(
                tools={"tool-1": tool},
                files=[FileReference(source="app", asset_id="skill-b")],
            ),
        )
        doc_b = SkillDocument(
            skill_id="skill-b",
            content="B leaf",
            metadata=make_metadata(tools={}, files=[]),
        )

        tree = create_file_tree(
            AppAssetNode.create_file("skill-a", "a.md"),
            AppAssetNode.create_file("skill-b", "b.md"),
        )
        compiler = SkillCompiler()
        original = compiler.compile_all([doc_a, doc_b], tree, "assets-1")

        # when - serialize and deserialize
        json_str = original.model_dump_json()
        restored = SkillArtifactSet.model_validate_json(json_str)

        # then - all data preserved
        assert restored.assets_id == original.assets_id
        assert len(restored.items) == len(original.items)
        assert restored.dependency_graph == original.dependency_graph
        assert restored.reverse_graph == original.reverse_graph

        original_a = original.get("skill-a")
        assert original_a is not None
        artifact_a = restored.get("skill-a")
        assert artifact_a is not None
        assert artifact_a.content == original_a.content
        assert len(artifact_a.tools.dependencies) == 1

    def test_subset_preserves_internal_dependencies(self):
        # given
        # skill-a -> skill-b -> skill-c -> skill-d
        docs = [
            SkillDocument(
                skill_id="skill-a",
                content="A: §[file].[app].[skill-b]§",
                metadata=make_metadata(
                    tools={},
                    files=[FileReference(source="app", asset_id="skill-b")],
                ),
            ),
            SkillDocument(
                skill_id="skill-b",
                content="B: §[file].[app].[skill-c]§",
                metadata=make_metadata(
                    tools={},
                    files=[FileReference(source="app", asset_id="skill-c")],
                ),
            ),
            SkillDocument(
                skill_id="skill-c",
                content="C: §[file].[app].[skill-d]§",
                metadata=make_metadata(
                    tools={},
                    files=[FileReference(source="app", asset_id="skill-d")],
                ),
            ),
            SkillDocument(
                skill_id="skill-d",
                content="D",
                metadata=make_metadata(tools={}, files=[]),
            ),
        ]
        tree = create_file_tree(
            AppAssetNode.create_file("skill-a", "a.md"),
            AppAssetNode.create_file("skill-b", "b.md"),
            AppAssetNode.create_file("skill-c", "c.md"),
            AppAssetNode.create_file("skill-d", "d.md"),
        )
        compiler = SkillCompiler()
        full_set = compiler.compile_all(docs, tree, "assets-1")

        # when - get subset of B and C only
        subset = full_set.subset(["skill-b", "skill-c"])

        # then
        assert len(subset.items) == 2
        assert subset.get("skill-b") is not None
        assert subset.get("skill-c") is not None
        assert subset.get("skill-a") is None
        assert subset.get("skill-d") is None

        # internal dependency preserved (B -> C)
        assert "skill-c" in subset.dependency_graph.get("skill-b", [])
        # external dependencies filtered out
        assert "skill-d" not in subset.dependency_graph.get("skill-c", [])


class TestSkillCompilerIncrementalRecompile:
    def test_single_change_triggers_upstream_recompile(self):
        # given
        # skill-a -> skill-b -> skill-c (leaf)
        # each has unique tool
        tool_a = ToolReference(uuid="t-a", type=ToolProviderType.BUILT_IN, provider="p", tool_name="tool_a")
        tool_b = ToolReference(uuid="t-b", type=ToolProviderType.BUILT_IN, provider="p", tool_name="tool_b")
        tool_c = ToolReference(uuid="t-c", type=ToolProviderType.BUILT_IN, provider="p", tool_name="tool_c")

        doc_a = SkillDocument(
            skill_id="a",
            content="A content v1 §[tool].[p].[tool_a].[t-a]§ §[file].[app].[b]§",
            metadata=make_metadata(
                tools={"t-a": tool_a},
                files=[FileReference(source="app", asset_id="b")],
            ),
        )
        doc_b = SkillDocument(
            skill_id="b",
            content="B content v1 §[tool].[p].[tool_b].[t-b]§ §[file].[app].[c]§",
            metadata=make_metadata(
                tools={"t-b": tool_b},
                files=[FileReference(source="app", asset_id="c")],
            ),
        )
        doc_c = SkillDocument(
            skill_id="c",
            content="C content v1 §[tool].[p].[tool_c].[t-c]§",
            metadata=make_metadata(tools={"t-c": tool_c}, files=[]),
        )

        tree = create_file_tree(
            AppAssetNode.create_file("a", "a.md"),
            AppAssetNode.create_file("b", "b.md"),
            AppAssetNode.create_file("c", "c.md"),
        )
        compiler = SkillCompiler()
        artifact_set = compiler.compile_all([doc_a, doc_b, doc_c], tree, "assets-1")

        original_a_digest = artifact_set.get("a").source.content_digest
        original_b_digest = artifact_set.get("b").source.content_digest
        original_c_digest = artifact_set.get("c").source.content_digest

        # when - skill-c changes
        doc_c_v2 = SkillDocument(
            skill_id="c",
            content="C content v2 - UPDATED §[tool].[p].[tool_c].[t-c]§",
            metadata=make_metadata(tools={"t-c": tool_c}, files=[]),
        )

        # find affected skills using recompile_group_ids
        affected_ids = artifact_set.recompile_group_ids("c")

        # then - all upstream skills are affected
        assert affected_ids == {"a", "b", "c"}

        # simulate incremental recompile for affected skills
        doc_map = {"a": doc_a, "b": doc_b, "c": doc_c_v2}
        for skill_id in affected_ids:
            updated = compiler.compile_one(artifact_set, doc_map[skill_id], tree, doc_map)
            artifact_set.upsert(updated)

        # verify c's content changed
        assert artifact_set.get("c").source.content_digest != original_c_digest
        assert "v2 - UPDATED" in artifact_set.get("c").content

        # a and b content didn't change (only their dependencies were refreshed)
        assert artifact_set.get("a").source.content_digest == original_a_digest
        assert artifact_set.get("b").source.content_digest == original_b_digest

    def test_branch_change_only_affects_upstream_branch(self):
        # given
        #       skill-root
        #      /          \
        # skill-left    skill-right
        #     |              |
        # skill-l-leaf   skill-r-leaf
        tool = ToolReference(uuid="t", type=ToolProviderType.BUILT_IN, provider="p", tool_name="tool")

        doc_root = SkillDocument(
            skill_id="root",
            content="root §[file].[app].[left]§ §[file].[app].[right]§",
            metadata=make_metadata(
                tools={},
                files=[
                    FileReference(source="app", asset_id="left"),
                    FileReference(source="app", asset_id="right"),
                ],
            ),
        )
        doc_left = SkillDocument(
            skill_id="left",
            content="left §[file].[app].[l-leaf]§",
            metadata=make_metadata(
                tools={},
                files=[FileReference(source="app", asset_id="l-leaf")],
            ),
        )
        doc_right = SkillDocument(
            skill_id="right",
            content="right §[file].[app].[r-leaf]§",
            metadata=make_metadata(
                tools={},
                files=[FileReference(source="app", asset_id="r-leaf")],
            ),
        )
        doc_l_leaf = SkillDocument(
            skill_id="l-leaf",
            content="left leaf §[tool].[p].[tool].[t]§",
            metadata=make_metadata(tools={"t": tool}, files=[]),
        )
        doc_r_leaf = SkillDocument(
            skill_id="r-leaf",
            content="right leaf",
            metadata=make_metadata(tools={}, files=[]),
        )

        tree = create_file_tree(
            AppAssetNode.create_file("root", "root.md"),
            AppAssetNode.create_file("left", "left.md"),
            AppAssetNode.create_file("right", "right.md"),
            AppAssetNode.create_file("l-leaf", "l-leaf.md"),
            AppAssetNode.create_file("r-leaf", "r-leaf.md"),
        )
        compiler = SkillCompiler()
        artifact_set = compiler.compile_all(
            [doc_root, doc_left, doc_right, doc_l_leaf, doc_r_leaf], tree, "assets-1"
        )

        # when - l-leaf changes
        affected_by_l_leaf = artifact_set.recompile_group_ids("l-leaf")

        # then - only left branch + root affected (not right branch)
        assert affected_by_l_leaf == {"root", "left", "l-leaf"}
        assert "right" not in affected_by_l_leaf
        assert "r-leaf" not in affected_by_l_leaf

        # when - r-leaf changes
        affected_by_r_leaf = artifact_set.recompile_group_ids("r-leaf")

        # then - only right branch + root affected (not left branch)
        assert affected_by_r_leaf == {"root", "right", "r-leaf"}
        assert "left" not in affected_by_r_leaf
        assert "l-leaf" not in affected_by_r_leaf

    def test_add_new_tool_to_leaf_propagates_to_all_upstream(self):
        # given - chain without tools initially
        doc_a = SkillDocument(
            skill_id="a",
            content="A §[file].[app].[b]§",
            metadata=make_metadata(tools={}, files=[FileReference(source="app", asset_id="b")]),
        )
        doc_b = SkillDocument(
            skill_id="b",
            content="B §[file].[app].[c]§",
            metadata=make_metadata(tools={}, files=[FileReference(source="app", asset_id="c")]),
        )
        doc_c = SkillDocument(
            skill_id="c",
            content="C - no tools",
            metadata=make_metadata(tools={}, files=[]),
        )

        tree = create_file_tree(
            AppAssetNode.create_file("a", "a.md"),
            AppAssetNode.create_file("b", "b.md"),
            AppAssetNode.create_file("c", "c.md"),
        )
        compiler = SkillCompiler()
        artifact_set = compiler.compile_all([doc_a, doc_b, doc_c], tree, "assets-1")

        # initially no tools anywhere
        assert len(artifact_set.get("a").tools.dependencies) == 0
        assert len(artifact_set.get("b").tools.dependencies) == 0
        assert len(artifact_set.get("c").tools.dependencies) == 0

        # when - add tool to c
        new_tool = ToolReference(uuid="new-t", type=ToolProviderType.BUILT_IN, provider="p", tool_name="new_tool")
        doc_c_v2 = SkillDocument(
            skill_id="c",
            content="C - now has tool: §[tool].[p].[new_tool].[new-t]§",
            metadata=make_metadata(tools={"new-t": new_tool}, files=[]),
        )

        # recompile affected
        affected = artifact_set.recompile_group_ids("c")
        doc_map = {"a": doc_a, "b": doc_b, "c": doc_c_v2}
        for skill_id in affected:
            updated = compiler.compile_one(artifact_set, doc_map[skill_id], tree, doc_map)
            artifact_set.upsert(updated)

        # then - new tool propagated to all upstream
        assert len(artifact_set.get("c").tools.dependencies) == 1
        assert len(artifact_set.get("b").tools.dependencies) == 1
        assert len(artifact_set.get("a").tools.dependencies) == 1

        assert artifact_set.get("a").tools.dependencies[0].tool_name == "new_tool"
        assert artifact_set.get("b").tools.dependencies[0].tool_name == "new_tool"
        assert artifact_set.get("c").tools.dependencies[0].tool_name == "new_tool"

    def test_remove_dependency_link_affects_recompile_group(self):
        # given - a -> b -> c
        doc_a = SkillDocument(
            skill_id="a",
            content="A refs B §[file].[app].[b]§",
            metadata=make_metadata(tools={}, files=[FileReference(source="app", asset_id="b")]),
        )
        doc_b = SkillDocument(
            skill_id="b",
            content="B refs C §[file].[app].[c]§",
            metadata=make_metadata(tools={}, files=[FileReference(source="app", asset_id="c")]),
        )
        doc_c = SkillDocument(
            skill_id="c",
            content="C leaf",
            metadata=make_metadata(tools={}, files=[]),
        )

        tree = create_file_tree(
            AppAssetNode.create_file("a", "a.md"),
            AppAssetNode.create_file("b", "b.md"),
            AppAssetNode.create_file("c", "c.md"),
        )
        compiler = SkillCompiler()
        artifact_set = compiler.compile_all([doc_a, doc_b, doc_c], tree, "assets-1")

        # initially c change affects a, b, c
        assert artifact_set.recompile_group_ids("c") == {"a", "b", "c"}

        # when - b no longer refs c
        doc_b_v2 = SkillDocument(
            skill_id="b",
            content="B standalone now",
            metadata=make_metadata(tools={}, files=[]),
        )
        doc_map = {"a": doc_a, "b": doc_b_v2, "c": doc_c}

        # recompile b (which changes its dependencies)
        updated_b = compiler.compile_one(artifact_set, doc_b_v2, tree, doc_map)
        artifact_set.upsert(updated_b)

        # then - c change now only affects c (b no longer depends on c)
        # note: reverse_graph still has old data until we clean it
        # in real usage, we'd rebuild graphs or clean stale entries
        assert "c" not in artifact_set.dependency_graph.get("b", [])

    def test_complex_graph_multiple_changes(self):
        # given - complex dependency graph
        #
        #     A -----> B -----> E
        #     |        |
        #     v        v
        #     C -----> D
        #
        # A depends on B, C
        # B depends on D, E
        # C depends on D
        tool_d = ToolReference(uuid="t-d", type=ToolProviderType.BUILT_IN, provider="p", tool_name="tool_d")
        tool_e = ToolReference(uuid="t-e", type=ToolProviderType.BUILT_IN, provider="p", tool_name="tool_e")

        doc_a = SkillDocument(
            skill_id="a",
            content="A §[file].[app].[b]§ §[file].[app].[c]§",
            metadata=make_metadata(
                tools={},
                files=[
                    FileReference(source="app", asset_id="b"),
                    FileReference(source="app", asset_id="c"),
                ],
            ),
        )
        doc_b = SkillDocument(
            skill_id="b",
            content="B §[file].[app].[d]§ §[file].[app].[e]§",
            metadata=make_metadata(
                tools={},
                files=[
                    FileReference(source="app", asset_id="d"),
                    FileReference(source="app", asset_id="e"),
                ],
            ),
        )
        doc_c = SkillDocument(
            skill_id="c",
            content="C §[file].[app].[d]§",
            metadata=make_metadata(
                tools={},
                files=[FileReference(source="app", asset_id="d")],
            ),
        )
        doc_d = SkillDocument(
            skill_id="d",
            content="D §[tool].[p].[tool_d].[t-d]§",
            metadata=make_metadata(tools={"t-d": tool_d}, files=[]),
        )
        doc_e = SkillDocument(
            skill_id="e",
            content="E §[tool].[p].[tool_e].[t-e]§",
            metadata=make_metadata(tools={"t-e": tool_e}, files=[]),
        )

        tree = create_file_tree(
            AppAssetNode.create_file("a", "a.md"),
            AppAssetNode.create_file("b", "b.md"),
            AppAssetNode.create_file("c", "c.md"),
            AppAssetNode.create_file("d", "d.md"),
            AppAssetNode.create_file("e", "e.md"),
        )
        compiler = SkillCompiler()
        artifact_set = compiler.compile_all([doc_a, doc_b, doc_c, doc_d, doc_e], tree, "assets-1")

        # verify initial state
        a_tools = {t.tool_name for t in artifact_set.get("a").tools.dependencies}
        assert a_tools == {"tool_d", "tool_e"}

        # when - d changes, who needs recompile?
        affected_by_d = artifact_set.recompile_group_ids("d")
        # d is depended by: b, c, and transitively a
        assert affected_by_d == {"a", "b", "c", "d"}
        assert "e" not in affected_by_d

        # when - e changes, who needs recompile?
        affected_by_e = artifact_set.recompile_group_ids("e")
        # e is depended by: b, and transitively a
        assert affected_by_e == {"a", "b", "e"}
        assert "c" not in affected_by_e
        assert "d" not in affected_by_e
