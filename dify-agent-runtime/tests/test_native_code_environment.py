"""Pure probe tests; no backend imports, service, image, or kernel qualification."""

import hashlib
import json
import os
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest
from importlib.machinery import ModuleSpec
from pathlib import Path
from types import ModuleType
from unittest.mock import patch

PROBE = Path(__file__).resolve().parents[1] / "docker/native-code-environment.py"


class EnvironmentProbeTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(PROBE.is_file(), "bounded runtime environment probe is missing")
        self.probe = runpy.run_path(str(PROBE))
        # The pinned fixture is unprivileged. File tests use real bytes/FDs;
        # translate only their synthetic ownership to root, preserving mode checks.
        self.trusted = self.probe["_trusted"]
        trusted = self.trusted
        ownership = patch.dict(
            trusted.__globals__,
            _trusted=lambda info, directory=False: trusted(
                os.stat_result(
                    (
                        info.st_mode,
                        info.st_ino,
                        info.st_dev,
                        info.st_nlink,
                        0,
                        info.st_gid,
                        info.st_size,
                        info.st_atime,
                        info.st_mtime,
                        info.st_ctime,
                    )
                ),
                directory,
            ),
        )
        ownership.start()
        self.addCleanup(ownership.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, self.fd)

    def manifest(self):
        return self.probe["ContentManifest"](self.fd)

    def profile(self, **changes):
        profile = {
            "python": "3.13.7",
            "implementation": "CPython",
            "architecture": "x86_64",
            "platform": "linux",
            "gil_disabled": False,
            "node": "v24.20.0",
            "packages": {"Jinja2": "3.1.6", "MarkupSafe": "3.0.3"},
        }
        profile.update(changes)
        return profile

    def test_concrete_manifest_canonical_digest_and_content_mutation(self):
        (self.root / "pkg").mkdir()
        (self.root / "pkg/z.py").write_bytes(b"z = 2\n")
        (self.root / "pkg/a.py").write_bytes(b"a = 1\n")
        manifest = self.manifest()
        manifest.add_tree("pkg")
        files = manifest.files()
        self.assertEqual([f["path"] for f in files], ["pkg/a.py", "pkg/z.py"])
        self.assertEqual(files[0]["sha256"], hashlib.sha256(b"a = 1\n").hexdigest())
        receipt = self.probe["make_receipt"](self.profile(), files)
        digest = receipt.pop("environment_content_sha256")
        expected = json.dumps(
            receipt, sort_keys=True, separators=(",", ":"), ensure_ascii=True
        ).encode()
        self.assertEqual(digest, hashlib.sha256(expected).hexdigest())
        receipt2 = self.probe["make_receipt"](self.profile(), list(reversed(files)))
        self.assertEqual(digest, receipt2["environment_content_sha256"])
        (self.root / "pkg/a.py").write_bytes(b"a = 7\n")
        changed = self.manifest()
        changed.add_tree("pkg")
        self.assertNotEqual(
            digest,
            self.probe["make_receipt"](self.profile(), changed.files())[
                "environment_content_sha256"
            ],
        )

    def test_profile_refuses_missing_mismatched_runtime_and_packages(self):
        validate = self.probe["validate_profile"]
        validate(self.profile())
        validate(self.profile(architecture="aarch64"))
        for bad in [
            self.profile(python="3.12.9"),
            self.profile(implementation="PyPy"),
            self.profile(architecture="riscv64"),
            self.profile(platform="darwin"),
            self.profile(gil_disabled=True),
            self.profile(node="v24.19.0"),
            self.profile(packages={"Jinja2": "3.1.5", "MarkupSafe": "3.0.3"}),
            self.profile(packages={"Jinja2": "3.1.6"}),
            self.profile(node=None),
        ]:
            with self.subTest(bad=bad), self.assertRaises(self.probe["Refusal"]):
                validate(bad)

    def test_path_escape_symlink_and_mutable_file_refused(self):
        (self.root / "pkg").mkdir()
        (self.root / "pkg/a.py").write_bytes(b"a")
        (self.root / "pkg/link").symlink_to("/etc/passwd")
        for path in ["../etc/passwd", "/etc/passwd", "pkg/../pkg/a.py", "pkg/link"]:
            with (
                self.subTest(path=path),
                self.assertRaises((self.probe["Refusal"], OSError)),
            ):
                self.manifest().add_file(path)
        with self.assertRaises((self.probe["Refusal"], OSError)):
            self.manifest().add_tree("pkg")
        (self.root / "pkg/link").unlink()
        (self.root / "pkg/a.py").chmod(0o666)
        with self.assertRaises((self.probe["Refusal"], OSError)):
            self.manifest().add_tree("pkg")

    def test_file_count_and_byte_limits_refuse(self):
        (self.root / "pkg").mkdir()
        (self.root / "pkg/a").write_bytes(b"abc")
        with (
            patch.dict(
                self.probe["ContentManifest"].add_tree.__globals__, MAX_FILE_BYTES=2
            ),
            self.assertRaises(self.probe["Refusal"]),
        ):
            self.manifest().add_tree("pkg")
        with (
            patch.dict(self.probe["ContentManifest"].add_tree.__globals__, MAX_FILES=0),
            self.assertRaises(self.probe["Refusal"]),
        ):
            self.manifest().add_tree("pkg")

    def test_untrusted_ownership_refused(self):
        with self.assertRaises(self.probe["Refusal"]):
            self.trusted(os.stat_result((0o100644, 0, 0, 1, 1000, 1000, 0, 0, 0, 0)))
        self.trusted(os.stat_result((0o100644, 0, 0, 1, 0, 0, 0, 0, 0, 0)))

    def test_empty_directory_traversal_is_globally_bounded(self):
        (self.root / "pkg/one/two").mkdir(parents=True)
        with (
            patch.dict(
                self.probe["ContentManifest"].add_tree.__globals__, MAX_ENTRIES=2
            ),
            self.assertRaises(self.probe["Refusal"]),
        ):
            self.manifest().add_tree("pkg")

    def test_file_mutation_during_hash_is_refused(self):
        target = self.root / "mutable"
        target.write_bytes(b"first")
        original_read = os.read

        def read_and_mutate(fd, size):
            content = original_read(fd, size)
            target.write_bytes(b"second")
            return content

        with (
            patch("os.read", side_effect=read_and_mutate),
            self.assertRaises(self.probe["Refusal"]),
        ):
            self.manifest().add_file("mutable")

    def test_wrong_package_origin_refused(self):
        self.probe["require_origin"](
            "/usr/local/lib/python3.13/site-packages/jinja2/__init__.py",
            "/usr/local/lib/python3.13/site-packages/jinja2/__init__.py",
        )
        for path in [
            "/tmp/jinja2/__init__.py",
            "/usr/local/lib/python3.13/site-packages/jinja2/../evil.py",
            None,
        ]:
            with self.subTest(path=path), self.assertRaises(self.probe["Refusal"]):
                self.probe["require_origin"](
                    path, "/usr/local/lib/python3.13/site-packages/jinja2/__init__.py"
                )

    def test_root_fd_captures_actual_absolute_path_chain(self):
        stamps = {}
        fd = self.probe["_root_fd"](stamps)
        try:
            self.assertEqual(set(stamps), {"/", "/usr", "/usr/local"})
            self.assertEqual(self.probe["_stamp"](os.fstat(fd)), stamps["/usr/local"])
            for path, expected in stamps.items():
                self.assertEqual(
                    self.probe["_stamp"](os.stat(path, follow_symlinks=False)), expected
                )
        finally:
            os.close(fd)

    def test_revalidation_preserves_existing_maximum_directory_depth(self):
        (self.root / "a/b/c/d/e/f/g/h").mkdir(parents=True)
        manifest = self.manifest()
        manifest.add_tree("a")
        manifest.revalidate()

    def synthetic_collection(self, import_hook=None, node_hook=None):
        """Real selected files, synthetic runtime/dependency API boundaries only."""
        site = self.root / "lib/python3.13/site-packages"
        (self.root / "bin").mkdir(exist_ok=True)
        for relative in ("bin/python3.13", "bin/node", "lib/libpython3.13.so.1.0"):
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"synthetic runtime fixture")
        for name in (
            "jinja2",
            "markupsafe",
            "jinja2-3.1.6.dist-info",
            "markupsafe-3.0.3.dist-info",
        ):
            path = site / name
            path.mkdir(parents=True, exist_ok=True)
            (path / "__init__.py").write_bytes(b"original measured package")
        for name, version in self.profile()["packages"].items():
            (site / f"{name.lower()}-{version}.dist-info/METADATA").write_text(
                f"Metadata-Version: 2.1\nName: {name}\nVersion: {version}\n"
            )
        suffix = ".cpython-313-x86_64-linux-gnu.so"
        (site / ("markupsafe/_speedups" + suffix)).write_bytes(b"synthetic extension")
        # Prepare replacement trees before the first snapshot so the hook only
        # changes the ancestor under test, not a higher unrelated directory.
        shutil.copytree(site, site.with_name("replacement-site"))
        (site.with_name("replacement-site") / "jinja2/__init__.py").write_bytes(
            b"replacement package"
        )
        shutil.copytree(self.root / "bin", self.root / "replacement-bin")

        collect = self.probe["collect_environment"]

        def root_fd(stamps=None):
            # Synthetic fixture's real ancestor metadata, without pretending its
            # /tmp ownership/mode is the production /usr/local trust policy.
            if stamps is not None:
                for path in [*reversed(self.root.parents), self.root]:
                    stamps[str(path)] = self.probe["_stamp"](path.stat())
            return os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)

        def origin(name):
            return str(
                site
                / (
                    name.replace(".", "/") + suffix
                    if name.endswith("._speedups")
                    else name + "/__init__.py"
                )
            )

        def find_spec(name):
            loader = self.probe["importlib"].machinery.ExtensionFileLoader(
                name, origin(name)
            )
            return ModuleSpec(name=name, loader=loader, origin=origin(name))

        def import_module(name):
            if import_hook is not None and name == "jinja2":
                import_hook(site)
            module = ModuleType(name)
            module.__file__ = origin(name)
            return module

        def node_version(_binary):
            if node_hook is not None:
                node_hook(self.root / "bin")
            return "v24.20.0"

        with (
            patch.dict(
                collect.__globals__,
                PREFIX=str(self.root),
                _root_fd=root_fd,
                node_version=node_version,
            ),
            patch.object(sys, "platform", "linux"),
            patch.object(sys, "prefix", str(self.root)),
            patch.object(sys, "base_prefix", str(self.root)),
            patch.object(sys, "executable", str(self.root / "bin/python3.13")),
            patch("platform.python_version", return_value="3.13.7"),
            patch("platform.python_implementation", return_value="CPython"),
            patch("platform.machine", return_value="x86_64"),
            patch(
                "sysconfig.get_config_var",
                side_effect=lambda key: suffix if key == "EXT_SUFFIX" else False,
            ),
            patch("importlib.util.find_spec", side_effect=find_spec),
            patch("importlib.import_module", side_effect=import_module),
        ):
            return collect()

    def test_nonisolated_interpreter_refuses_before_dependency_discovery(self):
        if sys.flags.isolated:
            completed = subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).resolve()),
                    f"{type(self).__name__}.{self._testMethodName}",
                    "-v",
                ],
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            self.assertEqual(
                completed.returncode, 0, completed.stdout + completed.stderr
            )
            self.assertIn("\nOK\n", completed.stderr)
            return
        with self.assertRaisesRegex(self.probe["Refusal"], "unexpected_python_origin"):
            self.synthetic_collection()

    def execute_with_isolated_interpreter(self):
        """Run the same unittest method with actual CPython isolated flags."""
        if sys.flags.isolated:
            return False
        selected = f"{type(self).__name__}.{self._testMethodName}"
        completed = subprocess.run(
            [sys.executable, "-I", str(Path(__file__).resolve()), selected, "-v"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertIn("Ran 1 test", completed.stderr)
        self.assertIn("\nOK\n", completed.stderr)
        return True

    def test_synthetic_collection_with_stable_ancestors(self):
        if self.execute_with_isolated_interpreter():
            return
        result = self.synthetic_collection()
        self.assertEqual(result["status"], "observed")

    def test_import_ancestor_substitution_and_restoration_refuses(self):
        if self.execute_with_isolated_interpreter():
            return
        seen = []

        def import_boundary(site):
            original = site.with_name("original-site")
            replacement = site.with_name("replacement-site")
            site.rename(original)
            replacement.rename(site)
            try:
                seen.append((site / "jinja2/__init__.py").read_bytes())
            finally:
                site.rename(replacement)
                original.rename(site)

        with self.assertRaisesRegex(self.probe["Refusal"], "path_chain_changed"):
            self.synthetic_collection(import_hook=import_boundary)
        self.assertEqual(seen, [b"replacement package"])
        self.assertEqual(
            (
                self.root / "lib/python3.13/site-packages/jinja2/__init__.py"
            ).read_bytes(),
            b"original measured package",
        )

    def test_import_ancestor_symlink_substitution_and_restoration_refuses(self):
        if self.execute_with_isolated_interpreter():
            return
        seen = []

        def import_boundary(site):
            original = site.with_name("original-site")
            site.rename(original)
            site.symlink_to(
                site.with_name("replacement-site"), target_is_directory=True
            )
            try:
                seen.append((site / "jinja2/__init__.py").read_bytes())
            finally:
                site.unlink()
                original.rename(site)

        with self.assertRaisesRegex(self.probe["Refusal"], "path_chain_changed"):
            self.synthetic_collection(import_hook=import_boundary)
        self.assertEqual(seen, [b"replacement package"])

    def test_node_ancestor_substitution_and_restoration_refuses(self):
        if self.execute_with_isolated_interpreter():
            return
        events = []

        def node_boundary(directory):
            original = directory.with_name("original-bin")
            replacement = directory.with_name("replacement-bin")
            directory.rename(original)
            replacement.rename(directory)
            try:
                events.append((directory / "node").read_bytes())
            finally:
                directory.rename(replacement)
                original.rename(directory)

        with self.assertRaisesRegex(self.probe["Refusal"], "path_chain_changed"):
            self.synthetic_collection(node_hook=node_boundary)
        self.assertEqual(events, [b"synthetic runtime fixture"])

    def fake_node(self, body):
        path = self.root / "node"
        path.write_text("#!" + sys.executable + "\n" + body)
        path.chmod(0o755)
        return str(path)

    def test_node_bounded_timeout_output_and_environment(self):
        node_version = self.probe["node_version"]
        path = self.fake_node(
            "import os; print('v24.20.0' if 'SECRET_SENTINEL' not in os.environ and 'NODE_OPTIONS' not in os.environ else 'leak')\n"
        )
        with patch.dict(
            os.environ,
            SECRET_SENTINEL="never-output-this-value",
            NODE_OPTIONS="--bad-option",
        ):
            self.assertEqual(node_version(path), "v24.20.0")
        with (
            patch.dict(node_version.__globals__, NODE_TIMEOUT_SECONDS=0.1),
            self.assertRaises(self.probe["Refusal"]),
        ):
            node_version(self.fake_node("import time; time.sleep(5)\n"))
        with self.assertRaises(self.probe["Refusal"]):
            node_version(self.fake_node("import os; os.write(1, b'x' * 100000)\n"))
        with self.assertRaises(self.probe["Refusal"]):
            node_version(self.fake_node("import sys; sys.exit(2)\n"))

    def test_refusal_output_contains_no_secrets_or_capability_claims(self):
        observe = self.probe["observe"]
        with (
            patch.dict(os.environ, SECRET_SENTINEL="never-output-this-value"),
            patch.dict(
                observe.__globals__,
                collect_environment=lambda: (_ for _ in ()).throw(
                    self.probe["Refusal"]("unsupported_python")
                ),
            ),
        ):
            result = observe()
        self.assertEqual(
            result,
            {
                "schema": "dify.native-code-environment/v1",
                "status": "unsupported",
                "reason": "unsupported_python",
            },
        )
        output = json.dumps(result)
        for forbidden in [
            "never-output-this-value",
            "SECRET_SENTINEL",
            "ready",
            "qualified",
            "HOME",
        ]:
            self.assertNotIn(forbidden, output)


if __name__ == "__main__":
    unittest.main(verbosity=2)
