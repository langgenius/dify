import copy
import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "fix_workflow_queues", Path(__file__).with_name("fix_workflow_queues.py")
)
repair = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(repair)

BASE = ",".join(repair.BASE_QUEUES)
FULL = ",".join(repair.BASE_QUEUES + repair.WORKFLOW_QUEUES)


def compose(value=BASE, before_worker="", after_worker="", newline="\n"):
    return (
        (
            "# Keep this comment and unrelated settings\n"
            "x-common: &common\n  LOG_LEVEL: INFO\n"
            "services:\n"
            + before_worker
            + "  worker:\n    image: langgenius/dify-api:deploy-saas\n"
            "    environment:\n      <<: *common\n      DEPLOYMENT_EDITION: CLOUD\n"
            f"      CELERY_QUEUES: {value}  # deliberately explicit\n"
            "      OTHER_CONFIG: unchanged\n" + after_worker + "volumes:\n  storage:\n"
        )
        .replace("\n", newline)
        .encode()
    )


OTHER_WORKERS = (
    "  priority_worker:\n    environment:\n      CELERY_QUEUES: priority_dataset,priority_pipeline\n"
    "  worker-plugin_autoupgrade:\n    environment:\n      CELERY_QUEUES: plugin\n"
    "  worker_beat:\n    environment:\n      MODE: beat\n"
)


class PatchPlanTests(unittest.TestCase):
    def test_preserves_every_other_byte_for_worker_at_different_positions(self):
        for before_worker, after_worker in ((OTHER_WORKERS, ""), ("", OTHER_WORKERS)):
            for quote in ("", "'", '"'):
                for newline in ("\n", "\r\n"):
                    with self.subTest(
                        before=bool(before_worker), quote=quote, newline=newline
                    ):
                        before = compose(
                            quote + BASE + quote, before_worker, after_worker, newline
                        )
                        after, old, new = repair.plan_patch(before)
                        self.assertEqual(
                            after, before.replace(BASE.encode(), FULL.encode(), 1)
                        )
                        self.assertEqual(old, list(repair.BASE_QUEUES))
                        self.assertEqual(
                            new, list(repair.BASE_QUEUES + repair.WORKFLOW_QUEUES)
                        )

    def test_only_appends_missing_names_and_keeps_existing_order(self):
        current = ",".join(reversed(repair.BASE_QUEUES)) + ",workflow_team"
        after, old, new = repair.plan_patch(compose(current))
        self.assertEqual(new, old + ["workflow_professional", "workflow_sandbox"])
        self.assertIn(",".join(new).encode(), after)

    def test_idempotent_when_all_queues_already_exist(self):
        before = compose(FULL)
        after, old, new = repair.plan_patch(before)
        self.assertEqual(after, before)
        self.assertEqual(old, new)

    def test_rejects_duplicate_unknown_missing_or_interpolated_queues(self):
        for value in (
            BASE + ",dataset",
            BASE + ",schedule_poller",
            BASE.replace("dataset,", ""),
            "${CELERY_QUEUES}",
            BASE + ", workflow_team",
            '"' + BASE + '\\n"',
        ):
            with (
                self.subTest(value=value),
                self.assertRaises(repair.UnsafeConfiguration),
            ):
                repair.plan_patch(compose(value))

    def test_missing_and_ambiguous_target_fields_fail_closed(self):
        original = compose()
        for content in (
            original.replace(b"  worker:", b"  another_worker:"),
            original.replace(b"CELERY_QUEUES:", b"OTHER_QUEUES:"),
            original.replace(
                b"    environment:", b"    environment: {}\n    environment:"
            ),
            original.replace(b"  worker:", b"  worker: {}\n  worker:"),
            original.replace(b"services:", b"services: {}\nservices:"),
            original.replace(
                b"      CELERY_QUEUES:",
                b"      CELERY_QUEUES: other\n      CELERY_QUEUES:",
            ),
        ):
            with (
                self.subTest(content=content),
                self.assertRaises(repair.UnsafeConfiguration),
            ):
                repair.plan_patch(content)

    def test_rejects_non_scalar_list_block_and_alias_values(self):
        values = ("[dataset,mail]", "true", "|\n        " + BASE, ">\n        " + BASE)
        for value in values:
            with (
                self.subTest(value=value),
                self.assertRaises(repair.UnsafeConfiguration),
            ):
                repair.plan_patch(compose(value))
        outside_alias = (
            b"x-queues: &queues " + BASE.encode() + b"\n" + compose("*queues")
        )
        with self.assertRaises(repair.UnsafeConfiguration):
            repair.plan_patch(outside_alias)
        worker_alias = (
            b"x-worker: &worker\n  environment:\n    CELERY_QUEUES: "
            + BASE.encode()
            + b"\nservices:\n  worker: *worker\n"
        )
        with self.assertRaises(repair.UnsafeConfiguration):
            repair.plan_patch(worker_alias)


class ResolvedValidationTests(unittest.TestCase):
    def setUp(self):
        self.before = {
            "services": {
                "worker": {
                    "environment": {
                        "DEPLOYMENT_EDITION": "CLOUD",
                        "CELERY_QUEUES": BASE,
                    }
                },
                "priority_worker": {
                    "environment": {
                        "CELERY_QUEUES": "priority_dataset,priority_pipeline"
                    }
                },
            }
        }
        self.after = copy.deepcopy(self.before)
        self.after["services"]["worker"]["environment"]["CELERY_QUEUES"] = FULL

    def test_accepts_exact_single_field_change(self):
        repair.validate_resolved(
            self.before,
            self.after,
            repair.BASE_QUEUES,
            repair.BASE_QUEUES + repair.WORKFLOW_QUEUES,
        )

    def test_rejects_overrides_non_cloud_or_unrelated_changes(self):
        for field, value in (
            ("CELERY_WORKER_QUEUES", "override"),
            ("DEPLOYMENT_EDITION", "COMMUNITY"),
            ("CELERY_QUEUES", "other"),
        ):
            before = copy.deepcopy(self.before)
            before["services"]["worker"]["environment"][field] = value
            with (
                self.subTest(field=field),
                self.assertRaises(repair.UnsafeConfiguration),
            ):
                repair.validate_resolved(
                    before,
                    self.after,
                    repair.BASE_QUEUES,
                    repair.BASE_QUEUES + repair.WORKFLOW_QUEUES,
                )
        self.after["services"]["priority_worker"]["environment"]["CELERY_QUEUES"] += (
            ",workflow_professional"
        )
        with self.assertRaises(repair.UnsafeConfiguration):
            repair.validate_resolved(
                self.before,
                self.after,
                repair.BASE_QUEUES,
                repair.BASE_QUEUES + repair.WORKFLOW_QUEUES,
            )


class ApplyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "docker-compose.yaml"
        self.before = compose()
        self.after = repair.plan_patch(self.before)[0]
        self.path.write_bytes(self.before)
        self.path.chmod(0o640)

    def apply(
        self, validate=lambda candidate: None, preflight=lambda: None, expected=None
    ):
        return repair.apply_patch(
            self.path,
            self.before,
            self.after,
            expected or repair.sha256(self.before),
            validate,
            preflight,
        )

    def test_backup_content_permissions_and_exact_change(self):
        backup = self.apply()
        self.assertEqual(backup.read_bytes(), self.before)
        self.assertEqual(self.path.read_bytes(), self.after)
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o640)
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o640)
        self.assertEqual(list(self.path.parent.glob(".snp836-candidate-*")), [])

    def test_noop_does_not_write_or_create_backup(self):
        original_inode = self.path.stat().st_ino
        backup = repair.apply_patch(
            self.path,
            self.before,
            self.before,
            repair.sha256(self.before),
            lambda candidate: None,
            lambda: None,
        )
        self.assertIsNone(backup)
        self.assertEqual(self.path.stat().st_ino, original_inode)
        self.assertEqual(list(self.path.parent.glob("*backup*")), [])

    def test_hash_and_before_content_guards(self):
        with self.assertRaises(repair.UnsafeConfiguration):
            self.apply(expected="0" * 64)
        self.path.write_bytes(self.before + b"# concurrent update\n")
        with self.assertRaises(repair.UnsafeConfiguration):
            self.apply()
        self.assertEqual(list(self.path.parent.glob("*backup*")), [])

    def test_validation_or_backlog_failure_does_not_write(self):
        def refuse(*args):
            raise repair.UnsafeConfiguration("unsafe")

        for arguments in ({"validate": refuse}, {"preflight": refuse}):
            with (
                self.subTest(arguments=arguments),
                self.assertRaises(repair.UnsafeConfiguration),
            ):
                self.apply(**arguments)
            self.assertEqual(self.path.read_bytes(), self.before)
            self.assertEqual(list(self.path.parent.glob("*backup*")), [])
            self.assertEqual(list(self.path.parent.glob(".snp836-candidate-*")), [])

    def test_concurrent_edit_after_validation_is_not_overwritten(self):
        concurrent = self.before + b"# operator edit\n"
        with self.assertRaises(repair.UnsafeConfiguration):
            self.apply(validate=lambda candidate: self.path.write_bytes(concurrent))
        self.assertEqual(self.path.read_bytes(), concurrent)

    def test_symlink_is_rejected(self):
        alias = self.path.parent / "alias"
        alias.symlink_to(self.path)
        with self.assertRaises(repair.UnsafeConfiguration):
            repair.regular_file(alias)


class BrokerPreflightTests(unittest.TestCase):
    def setUp(self):
        self.env = {"CELERY_BROKER_URL": "redis://fake-fixture:6379/1"}
        self.config = {
            "services": {
                "api": {"environment": self.env.copy()},
                "worker": {"environment": self.env.copy()},
            }
        }

    def test_matching_plain_broker_is_accepted(self):
        repair.validate_broker_environments(
            self.config, [self.env.copy(), self.env.copy(), self.env.copy()]
        )

    def test_namespace_or_broker_mismatch_fails_at_every_layer(self):
        for layer in ("api", "worker", "runtime"):
            for setting, value in (
                ("REDIS_KEY_PREFIX", "isolated"),
                ("CELERY_BROKER_URL", "redis://different-fixture:6379/2"),
                ("CELERY_USE_SENTINEL", "true"),
                ("BROKER_USE_SSL", "true"),
            ):
                with (
                    self.subTest(layer=layer, setting=setting),
                    self.assertRaises(repair.UnsafeConfiguration),
                ):
                    config = copy.deepcopy(self.config)
                    runtime = [self.env.copy()]
                    target = (
                        runtime[0]
                        if layer == "runtime"
                        else config["services"][layer]["environment"]
                    )
                    target[setting] = value
                    repair.validate_broker_environments(config, runtime)

    def test_any_workflow_backlog_unacked_or_invalid_reply_blocks_apply(self):
        empty = {queue: 0 for queue in repair.WORKFLOW_QUEUES}
        empty.update(unacked=0, unacked_index=0)
        with (
            patch.object(repair, "check_runtime_broker"),
            patch.object(repair, "safe_command") as command,
        ):
            command.return_value = repair.json.dumps(empty)
            self.assertEqual(repair.broker_check(self.config), empty)
            for key in empty:
                command.return_value = repair.json.dumps({**empty, key: 1})
                with (
                    self.subTest(key=key),
                    self.assertRaises(repair.UnsafeConfiguration),
                ):
                    repair.broker_check(self.config)
            for invalid in ({}, {**empty, "unknown": 0}, {**empty, "unacked": False}):
                command.return_value = repair.json.dumps(invalid)
                with self.assertRaises(repair.UnsafeConfiguration):
                    repair.broker_check(self.config)

    def test_runtime_requires_exact_topology_labels_and_real_worker_queues(self):
        self.config["services"]["worker"]["deploy"] = {"replicas": 2}
        containers = []
        for index, service in enumerate(("api", "worker", "worker")):
            containers.append(
                {
                    "Id": f"fixture-{index}",
                    "State": {"Running": True},
                    "Config": {
                        "Env": [
                            "CELERY_BROKER_URL=" + self.env["CELERY_BROKER_URL"],
                            "CELERY_QUEUES=" + BASE,
                        ],
                        "Labels": {
                            "com.docker.compose.service": service,
                            "com.docker.compose.project": "langgenius",
                            "com.docker.compose.project.config_files": str(
                                repair.TARGET
                            ),
                        },
                    },
                }
            )
        responses = [
            "fixture-1\nfixture-2\n",
            repair.json.dumps(containers),
            "celery\0worker\0-Q\0" + BASE + "\0",
            "celery\0worker\0-Q\0" + BASE + "\0",
        ]
        with patch.object(repair, "safe_command", side_effect=responses):
            repair.check_runtime_broker(self.config)
        with patch.object(repair, "safe_command", return_value="one-worker-only\n"):
            with self.assertRaises(repair.UnsafeConfiguration):
                repair.check_runtime_broker(self.config)
        with patch.object(
            repair,
            "safe_command",
            side_effect=responses[:2] + ["celery\0-Q\0wrong_queue\0"],
        ):
            with self.assertRaises(repair.UnsafeConfiguration):
                repair.check_runtime_broker(self.config)
        containers[0]["Config"]["Labels"]["com.docker.compose.project.config_files"] = (
            "/different/compose.yaml"
        )
        with patch.object(
            repair,
            "safe_command",
            side_effect=[responses[0], repair.json.dumps(containers)],
        ):
            with self.assertRaises(repair.UnsafeConfiguration):
                repair.check_runtime_broker(self.config)


if __name__ == "__main__":
    unittest.main()
