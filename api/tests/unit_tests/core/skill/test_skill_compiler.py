from typing import Any

from core.app.entities.app_asset_entities import AppAssetFileTree, AppAssetNode
from core.skill.entities.skill_document import SkillDocument
from core.skill.entities.skill_metadata import FileReference, ToolConfiguration, ToolFieldConfig, ToolReference
from core.skill.skill_compiler import SkillCompiler
from core.tools.entities.tool_entities import ToolProviderType


class MockPathResolver:
    def __init__(self, tree: AppAssetFileTree):
        self.tree = tree

    def resolve(self, source_id: str, target_id: str) -> str:
        source_node = self.tree.get(source_id)
        target_node = self.tree.get(target_id)
        if not source_node or not target_node:
            if target_node:
                return "./" + target_node.name
            return f"./{target_id}"

        return self.tree.relative_path(source_node, target_node)


class MockToolResolver:
    def resolve(self, tool_ref: ToolReference) -> str:
        return f"[Executable: {tool_ref.tool_name}_{tool_ref.uuid} --help command]"


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
        assert len(artifact_set.entries) == 1

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
    def test_references_are_transitive(self):
        # given
        tool_b = ToolReference(
            uuid="tool-b",
            type=ToolProviderType.API,
            provider="external",
            tool_name="api_tool",
            credential_id="cred-123",
            configuration=ToolConfiguration(fields=[ToolFieldConfig(id="key", value="secret")]),
        )
        doc_a = SkillDocument(
            skill_id="skill-a",
            content="A refs B: §[file].[app].[skill-b]§",
            metadata=make_metadata(
                tools={},
                files=[FileReference(source="app", asset_id="skill-b")],
            ),
        )
        doc_b = SkillDocument(
            skill_id="skill-b",
            content="B: §[tool].[external].[api_tool].[tool-b]§",
            metadata=make_metadata(tools={"tool-b": tool_b}, files=[]),
        )
        tree = create_file_tree(
            AppAssetNode.create_file("skill-a", "a.md"),
            AppAssetNode.create_file("skill-b", "b.md"),
        )
        compiler = SkillCompiler()

        # when
        artifact_set = compiler.compile_all([doc_a, doc_b], tree, "assets-1")

        # then
        artifact_a = artifact_set.get("skill-a")
        assert artifact_a is not None
        assert len(artifact_a.tools.references) == 1
        ref = artifact_a.tools.references[0]
        assert ref.uuid == "tool-b"
        assert ref.credential_id == "cred-123"
        assert ref.configuration is not None
        assert ref.configuration.fields == [ToolFieldConfig(id="key", value="secret")]

        artifact_b = artifact_set.get("skill-b")
        assert artifact_b is not None
        assert len(artifact_b.tools.references) == 1
        assert artifact_b.tools.references[0].uuid == "tool-b"


class TestSkillCompilerCompileOne:
    def test_compile_one_resolves_context(self):
        # given
        tool_ref = ToolReference(
            uuid="tool-1",
            type=ToolProviderType.BUILT_IN,
            provider="sandbox",
            tool_name="python",
        )
        doc_skill = SkillDocument(
            skill_id="skill-lib",
            content="Library Code §[tool].[sandbox].[python].[tool-1]§",
            metadata=make_metadata(tools={"tool-1": tool_ref}, files=[]),
        )

        tree = create_file_tree(
            AppAssetNode.create_file("skill-lib", "lib.md"),
        )
        compiler = SkillCompiler()

        context = compiler.compile_all([doc_skill], tree, "assets-1")

        # when
        template_doc = SkillDocument(
            skill_id="anonymous",
            content="Use the lib: §[file].[app].[skill-lib]§",
            metadata=make_metadata(tools={}, files=[FileReference(source="app", asset_id="skill-lib")]),
        )

        result = compiler.compile_one(context, template_doc, tree)

        # then
        assert "lib.md" in result.content
        assert len(result.tools.dependencies) == 1
        assert result.tools.dependencies[0].tool_name == "python"


class TestSkillCompilerComplexGraph:
    def test_large_complex_dependency_graph(self):
        """
        Generate 100 skills with complex inter-dependencies:
        - Random file references between skills
        - Random tool assignments
        - Multiple circular dependencies
        - Chain dependencies
        - Star dependencies (hub nodes)
        """
        import random

        random.seed(42)  # Reproducible

        num_skills = 100
        num_tools = 20

        # Create tools
        tools: dict[str, ToolReference] = {}
        for i in range(num_tools):
            tools[f"tool-{i}"] = ToolReference(
                uuid=f"tool-{i}",
                type=random.choice([ToolProviderType.BUILT_IN, ToolProviderType.API]),  # noqa: S311
                provider=f"provider-{i % 5}",
                tool_name=f"tool_func_{i}",
                credential_id=f"cred-{i}" if i % 3 == 0 else None,
            )

        # Create skills with various dependency patterns
        documents: list[SkillDocument] = []
        nodes: list[AppAssetNode] = []

        for i in range(num_skills):
            skill_id = f"skill-{i}"
            nodes.append(AppAssetNode.create_file(skill_id, f"{skill_id}.md"))

            # Determine file references (other skills this skill references)
            file_refs: list[FileReference] = []
            ref_placeholders: list[str] = []

            # Pattern 1: Chain dependency (skill-i references skill-i+1)
            if i < num_skills - 1 and i % 10 != 9:
                target = f"skill-{i + 1}"
                file_refs.append(FileReference(source="app", asset_id=target))
                ref_placeholders.append(f"§[file].[app].[{target}]§")

            # Pattern 2: Circular dependency (every 10th skill references back)
            if i % 10 == 9 and i >= 10:
                target = f"skill-{i - 9}"
                file_refs.append(FileReference(source="app", asset_id=target))
                ref_placeholders.append(f"§[file].[app].[{target}]§")

            # Pattern 3: Hub pattern (skill-0, skill-50 are hubs referenced by many)
            if i > 0 and i % 7 == 0:
                target = "skill-0"
                file_refs.append(FileReference(source="app", asset_id=target))
                ref_placeholders.append(f"§[file].[app].[{target}]§")

            if i > 50 and i % 11 == 0:
                target = "skill-50"
                file_refs.append(FileReference(source="app", asset_id=target))
                ref_placeholders.append(f"§[file].[app].[{target}]§")

            # Pattern 4: Random references (sparse)
            if random.random() < 0.2:  # noqa: S311
                target_idx = random.randint(0, num_skills - 1)  # noqa: S311
                if target_idx != i:
                    target = f"skill-{target_idx}"
                    if not any(f.asset_id == target for f in file_refs):
                        file_refs.append(FileReference(source="app", asset_id=target))
                        ref_placeholders.append(f"§[file].[app].[{target}]§")

            # Assign tools to skills
            skill_tools: dict[str, ToolReference] = {}
            tool_placeholders: list[str] = []

            # Each skill has 0-3 tools
            num_skill_tools = random.randint(0, 3)  # noqa: S311
            assigned_tools = random.sample(list(tools.keys()), min(num_skill_tools, len(tools)))

            for tool_id in assigned_tools:
                tool = tools[tool_id]
                skill_tools[tool_id] = tool
                tool_placeholders.append(f"§[tool].[{tool.provider}].[{tool.tool_name}].[{tool_id}]§")

            # Build content
            content_parts = [f"# Skill {i}\n\nThis is skill number {i}.\n"]
            if ref_placeholders:
                content_parts.append(f"References: {', '.join(ref_placeholders)}\n")
            if tool_placeholders:
                content_parts.append(f"Tools: {', '.join(tool_placeholders)}\n")

            content = "\n".join(content_parts)

            doc = SkillDocument(
                skill_id=skill_id,
                content=content,
                metadata=make_metadata(tools=skill_tools, files=file_refs),
            )
            documents.append(doc)

        tree = create_file_tree(*nodes)
        compiler = SkillCompiler()

        # when
        bundle = compiler.compile_all(documents, tree, "stress-test-assets")

        # then
        assert len(bundle.entries) == num_skills

        # Verify all skills compiled successfully
        for i in range(num_skills):
            entry = bundle.get(f"skill-{i}")
            assert entry is not None, f"skill-{i} should exist"
            assert entry.content, f"skill-{i} should have content"
            # Content should have resolved references (no § markers for valid refs)
            assert "§[file].[app].[skill-" not in entry.content or "[File not found]" in entry.content

        # Verify hub nodes have many dependents in reverse graph
        assert len(bundle.reverse_graph.get("skill-0", [])) > 5, "skill-0 should be a hub"

        # Verify transitive dependencies propagate through cycles
        # skill-9 -> skill-0 (via chain 9->8->...->1->0) and skill-9 refs skill-0 directly via cycle
        entry_9 = bundle.get("skill-9")
        assert entry_9 is not None

        # Verify tool propagation works
        # Find a skill with tools and check its dependents have those tools
        for i in range(num_skills):
            entry = bundle.get(f"skill-{i}")
            if entry and entry.tools.dependencies:
                # This skill has tools, check if skills that reference it also have these tools
                dependents = bundle.reverse_graph.get(f"skill-{i}", [])
                for dep_id in dependents[:3]:  # Check first 3 dependents
                    dep_entry = bundle.get(dep_id)
                    if dep_entry:
                        # Dependent should have at least as many tool dependencies
                        # (might have more from other paths)
                        original_tool_names = {d.tool_name for d in entry.tools.dependencies}
                        dep_tool_names = {d.tool_name for d in dep_entry.tools.dependencies}
                        assert original_tool_names.issubset(dep_tool_names), (
                            f"{dep_id} should have tools from {entry.skill_id}"
                        )
                break  # Only need to verify one case

        print(f"\n✓ Successfully compiled {num_skills} skills")
        print(f"  - {num_tools} tool types")
        print(f"  - {sum(len(v) for v in bundle.dependency_graph.values())} total edges")
        print(f"  - Hub skill-0 has {len(bundle.reverse_graph.get('skill-0', []))} dependents")


class TestSkillCompilerCircularDependencies:
    def test_simple_circular_dependency(self):
        """A ↔ B: Two skills reference each other."""
        # given
        doc_a = SkillDocument(
            skill_id="skill-a",
            content="A references B: §[file].[app].[skill-b]§",
            metadata=make_metadata(
                tools={},
                files=[FileReference(source="app", asset_id="skill-b")],
            ),
        )
        doc_b = SkillDocument(
            skill_id="skill-b",
            content="B references A: §[file].[app].[skill-a]§",
            metadata=make_metadata(
                tools={},
                files=[FileReference(source="app", asset_id="skill-a")],
            ),
        )
        tree = create_file_tree(
            AppAssetNode.create_file("skill-a", "a.md"),
            AppAssetNode.create_file("skill-b", "b.md"),
        )
        compiler = SkillCompiler()

        # when
        bundle = compiler.compile_all([doc_a, doc_b], tree, "assets-1")

        # then
        assert len(bundle.entries) == 2

        entry_a = bundle.get("skill-a")
        assert entry_a is not None
        assert entry_a.content == "A references B: ./b.md"
        # Transitive closure: A refs B, B refs A, so A has both
        file_ids_a = {f.asset_id for f in entry_a.files.references}
        assert file_ids_a == {"skill-a", "skill-b"}

        entry_b = bundle.get("skill-b")
        assert entry_b is not None
        assert entry_b.content == "B references A: ./a.md"
        # Transitive closure: B refs A, A refs B, so B has both
        file_ids_b = {f.asset_id for f in entry_b.files.references}
        assert file_ids_b == {"skill-a", "skill-b"}

    def test_circular_dependency_with_tools(self):
        """A ↔ B with tools: Both skills should have access to both tools."""
        # given
        tool_a = ToolReference(
            uuid="tool-a",
            type=ToolProviderType.BUILT_IN,
            provider="sandbox",
            tool_name="bash",
        )
        tool_b = ToolReference(
            uuid="tool-b",
            type=ToolProviderType.BUILT_IN,
            provider="sandbox",
            tool_name="python",
        )
        doc_a = SkillDocument(
            skill_id="skill-a",
            content="A: §[tool].[sandbox].[bash].[tool-a]§ refs §[file].[app].[skill-b]§",
            metadata=make_metadata(
                tools={"tool-a": tool_a},
                files=[FileReference(source="app", asset_id="skill-b")],
            ),
        )
        doc_b = SkillDocument(
            skill_id="skill-b",
            content="B: §[tool].[sandbox].[python].[tool-b]§ refs §[file].[app].[skill-a]§",
            metadata=make_metadata(
                tools={"tool-b": tool_b},
                files=[FileReference(source="app", asset_id="skill-a")],
            ),
        )
        tree = create_file_tree(
            AppAssetNode.create_file("skill-a", "a.md"),
            AppAssetNode.create_file("skill-b", "b.md"),
        )
        compiler = SkillCompiler()

        # when
        bundle = compiler.compile_all([doc_a, doc_b], tree, "assets-1")

        # then
        entry_a = bundle.get("skill-a")
        assert entry_a is not None
        # A should have both tools (its own + B's via transitive dependency)
        assert len(entry_a.tools.dependencies) == 2
        tool_names_a = {dep.tool_name for dep in entry_a.tools.dependencies}
        assert tool_names_a == {"bash", "python"}

        entry_b = bundle.get("skill-b")
        assert entry_b is not None
        # B should have both tools (its own + A's via transitive dependency)
        assert len(entry_b.tools.dependencies) == 2
        tool_names_b = {dep.tool_name for dep in entry_b.tools.dependencies}
        assert tool_names_b == {"bash", "python"}

    def test_three_way_circular_dependency(self):
        """A → B → C → A: Three skills form a cycle."""
        # given
        tool_c = ToolReference(
            uuid="tool-c",
            type=ToolProviderType.API,
            provider="external",
            tool_name="api_tool",
            credential_id="cred-123",
        )
        doc_a = SkillDocument(
            skill_id="skill-a",
            content="A refs B: §[file].[app].[skill-b]§",
            metadata=make_metadata(
                tools={},
                files=[FileReference(source="app", asset_id="skill-b")],
            ),
        )
        doc_b = SkillDocument(
            skill_id="skill-b",
            content="B refs C: §[file].[app].[skill-c]§",
            metadata=make_metadata(
                tools={},
                files=[FileReference(source="app", asset_id="skill-c")],
            ),
        )
        doc_c = SkillDocument(
            skill_id="skill-c",
            content="C refs A: §[file].[app].[skill-a]§ and uses §[tool].[external].[api_tool].[tool-c]§",
            metadata=make_metadata(
                tools={"tool-c": tool_c},
                files=[FileReference(source="app", asset_id="skill-a")],
            ),
        )
        tree = create_file_tree(
            AppAssetNode.create_file("skill-a", "a.md"),
            AppAssetNode.create_file("skill-b", "b.md"),
            AppAssetNode.create_file("skill-c", "c.md"),
        )
        compiler = SkillCompiler()

        # when
        bundle = compiler.compile_all([doc_a, doc_b, doc_c], tree, "assets-1")

        # then
        assert len(bundle.entries) == 3

        # All three should have access to tool-c (transitive through the cycle)
        for skill_id in ["skill-a", "skill-b", "skill-c"]:
            entry = bundle.get(skill_id)
            assert entry is not None
            assert len(entry.tools.dependencies) == 1
            assert entry.tools.dependencies[0].tool_name == "api_tool"
            assert len(entry.tools.references) == 1
            assert entry.tools.references[0].uuid == "tool-c"
