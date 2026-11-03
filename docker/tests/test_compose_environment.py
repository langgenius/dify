"""Exercise copied Docker defaults without starting containers."""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

DOCKER_DIR = Path(__file__).resolve().parents[1]


class ComposeEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="dify-compose-env-")
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        shutil.copyfile(DOCKER_DIR / "docker-compose.yaml", self.project / "docker-compose.yaml")
        for source in (DOCKER_DIR / "envs").rglob("*.defaults"):
            target = self.project / source.relative_to(DOCKER_DIR)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        self.copy_template(
            ".env.example",
            ".env",
            {"DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN": "test-sandbox-token"},
        )

    def copy_template(self, source, target, values=None):
        content = (DOCKER_DIR / source).read_text()
        for key, value in (values or {}).items():
            content, count = re.subn(
                rf"(?m)^(?:#\s*)?{re.escape(key)}=.*$",
                lambda _, setting=f"{key}={value}": setting,
                content,
            )
            self.assertEqual(count, 1, f"Expected one setting for {key} in {source}")
        destination = self.project / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(content)

    def override_root(self, values):
        with (self.project / ".env").open("a") as target:
            target.write("\n" + "\n".join(f"{key}={value}" for key, value in values.items()) + "\n")

    def render(self, *compose_args):
        inputs = set(re.findall(r"\$\{(\w+)", (DOCKER_DIR / "docker-compose.yaml").read_text()))
        for source in (DOCKER_DIR / "envs").rglob("*.defaults"):
            inputs.update(re.findall(r"\$\{(\w+)", source.read_text()))
        env = {key: value for key, value in os.environ.items() if key not in inputs and not key.startswith("COMPOSE_")}
        result = subprocess.run(
            [
                "docker",
                "compose",
                *compose_args,
                "--profile",
                "*",
                "config",
                "--format",
                "json",
            ],
            cwd=self.project,
            env=env,
            text=True,
            capture_output=True,
            check=True,
        )
        return json.loads(result.stdout)["services"]

    def test_minimal_setup_has_working_connection_defaults(self):
        services = self.render()
        for name in ("api", "worker", "worker_beat", "plugin_daemon"):
            values = services[name]["environment"]
            for key, expected in {
                "DB_HOST": "db_postgres",
                "DB_USERNAME": "postgres",
                "DB_PASSWORD": "difyai123456",
                "DB_PORT": "5432",
                "REDIS_HOST": "redis",
                "REDIS_PORT": "6379",
                "REDIS_PASSWORD": "difyai123456",
            }.items():
                self.assertEqual(values[key], expected, f"{name}.{key}")
        self.assertEqual(services["plugin_daemon"]["environment"]["DB_DATABASE"], "dify_plugin")
        self.assertEqual(services["web"]["environment"]["SERVER_CONSOLE_API_URL"], "http://api:5001")
        self.assertEqual(services["web"]["environment"]["NEXT_PUBLIC_ENABLE_AGENT_V2"], "true")
        self.assertEqual(
            services["local_sandbox"]["environment"]["SHELLCTL_AUTH_TOKEN"],
            "test-sandbox-token",
        )
        self.assertEqual(
            services["agent_backend"]["environment"]["DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN"],
            "test-sandbox-token",
        )
        self.assertFalse((DOCKER_DIR / ".env.custom.example").exists())
        self.assertEqual(services["elasticsearch"]["environment"]["xpack.security.enabled"], "true")
        self.assertEqual(services["elasticsearch"]["environment"]["discovery.type"], "single-node")

    def test_copying_defaults_without_changes_preserves_service_values(self):
        baseline = self.render()
        for source in (DOCKER_DIR / "envs").rglob("*.defaults"):
            # This KnowledgeFS parser file deliberately has a different override basename.
            if source.name == "knowledge-fs-unstructured-service.defaults":
                continue
            self.copy_template(
                str(source.relative_to(DOCKER_DIR)),
                str(source.relative_to(DOCKER_DIR).with_suffix(".env")),
            )
        actual = self.render()
        for name, service in baseline.items():
            for key, value in service.get("environment", {}).items():
                self.assertEqual(actual[name]["environment"].get(key), value, f"{name}.{key}")

    def test_api_and_weaviate_defaults_and_isolated_overrides(self):
        cases = [
            ("core-services/api-worker", "worker", "CELERY_WORKER_AMOUNT", "CELERY_WORKER_AMOUNT", "4", "2", "3"),
            (
                "core-services/api-worker",
                "api",
                "SERVER_WORKER_CLASS",
                "SERVER_WORKER_CLASS",
                "gevent",
                "sync",
                "gthread",
            ),
            ("core-services/api-worker", "api", "GUNICORN_TIMEOUT", "GUNICORN_TIMEOUT", "360", "120", "240"),
            (
                "vectorstores/weaviate",
                "weaviate",
                "WEAVIATE_AUTHENTICATION_ANONYMOUS_ACCESS_ENABLED",
                "AUTHENTICATION_ANONYMOUS_ACCESS_ENABLED",
                "true",
                "false",
                "true",
            ),
        ]
        root = self.project / ".env"
        initial_root = root.read_text()
        for path, service, key, native, default, custom, root_value in cases:
            with self.subTest(setting=key):
                source = f"envs/{path}.defaults"
                target = f"envs/{path}.env"
                try:
                    self.assertEqual(self.render()[service]["environment"].get(native), default, "fresh deployment")

                    # Exercise root customization without any service override file.
                    self.override_root({key: custom})
                    self.assertEqual(self.render()[service]["environment"][native], custom, "root only")
                    root.write_text(initial_root)
                    self.assertEqual(self.render()[service]["environment"][native], default, "restored root")

                    self.copy_template(source, target)
                    self.assertEqual(self.render()[service]["environment"][native], default, "unchanged copy")
                    self.copy_template(source, target, {key: custom})
                    self.assertEqual(self.render()[service]["environment"][native], custom, "service only")

                    # Leave the service file unchanged while changing only the root file.
                    self.override_root({key: root_value})
                    self.assertEqual(self.render()[service]["environment"][native], root_value, "root precedence")
                finally:
                    (self.project / target).unlink(missing_ok=True)
                    root.write_text(initial_root)

    def test_copying_api_worker_defaults_does_not_activate_optional_settings(self):
        baseline = self.render()
        self.copy_template("envs/core-services/api-worker.defaults", "envs/core-services/api-worker.env")
        # Compare the entire configuration, including extra variables introduced by an unsafe copy.
        self.assertEqual(self.render(), baseline)

    def test_api_worker_overrides_preserve_legacy_settings_and_precedence(self):
        consumers = (
            "api",
            "api_websocket",
            "worker",
            "worker_knowledge_fs_upgrade",
            "worker_beat",
            "knowledge_fs_document_worker",
            "knowledge_fs_source_worker",
            "knowledge_fs_research_worker",
            "knowledge_fs_maintenance_worker",
            "knowledge_fs_dispatch_worker",
            "plugin_daemon",
        )
        baseline = self.render()
        legacy = self.project / "envs/core-services/shared.env"
        legacy.write_text("DB_HOST=legacy-db\n")

        services = self.render()
        for name in consumers:
            self.assertEqual(services[name]["environment"]["DB_HOST"], "legacy-db", name)

        source = "envs/core-services/api-worker.defaults"
        target = "envs/core-services/api-worker.env"
        # An unchanged copy must not mask existing shared.env customizations.
        self.copy_template(source, target)
        self.assertEqual(self.render(), services)

        self.copy_template(source, target, {"DB_HOST": "api-worker-db"})
        services = self.render()
        for name in consumers:
            self.assertEqual(services[name]["environment"]["DB_HOST"], "api-worker-db", name)
        for name in baseline.keys() - set(consumers):
            self.assertEqual(services[name], baseline[name], name)

        # Change only the root file while retaining both local override files.
        self.override_root({"DB_HOST": "root-db"})
        services = self.render()
        for name in consumers:
            self.assertEqual(services[name]["environment"]["DB_HOST"], "root-db", name)
        self.assertEqual(legacy.read_text(), "DB_HOST=legacy-db\n")

    def test_consolidated_settings_reach_consumers_and_respect_root_precedence(self):
        api_services = ("api", "api_websocket")
        worker_services = (
            "worker",
            "worker_knowledge_fs_upgrade",
            "knowledge_fs_document_worker",
            "knowledge_fs_source_worker",
            "knowledge_fs_research_worker",
            "knowledge_fs_maintenance_worker",
            "knowledge_fs_dispatch_worker",
        )
        vector_clients = (*api_services, "worker", "worker_knowledge_fs_upgrade", "worker_beat")
        cases = [
            (
                "core-services/api-worker.defaults",
                (*api_services, *worker_services, "worker_beat"),
                {
                    "CODE_MAX_STRING_LENGTH": ("500000", "600000"),
                    "ENABLE_OTEL": ("true", "false"),
                    "OTLP_BASE_ENDPOINT": ("http://collector:4318", "http://root-collector:4318"),
                    "CELERY_BROKER_VISIBILITY_TIMEOUT": ("10800", "14400"),
                    "OPS_TRACE_QUEUE": ("custom_traces", "root_traces"),
                    "KNOWLEDGE_FS_BACKGROUND_POLL_INTERVAL_SECONDS": ("7", "9"),
                    "AGENT_BACKEND_HOME_SNAPSHOT_TIMEOUT_SECONDS": ("60", "90"),
                    "UNSTRUCTURED_API_URL": ("http://parser:8000", "http://root-parser:8000"),
                    "S3_ENDPOINT": ("https://storage.example.test", "https://root-storage.example.test"),
                    "TENCENT_COS_SECRET_KEY": ("app-storage-key", "root-storage-key"),
                },
            ),
            (
                "core-services/api.defaults",
                api_services,
                {"GUNICORN_KEEP_ALIVE": ("20", "30"), "RESPECT_XFORWARD_HEADERS_ENABLED": ("false", "true")},
            ),
            (
                "core-services/worker.defaults",
                worker_services,
                {"CELERY_AUTO_SCALE": ("true", "false"), "CELERY_MIN_WORKERS": ("2", "3")},
            ),
            ("vectorstores/weaviate.defaults", vector_clients, {"WEAVIATE_TOKENIZATION": ("field", "word")}),
            ("vectorstores/qdrant.defaults", vector_clients, {"QDRANT_CLIENT_TIMEOUT": ("42", "60")}),
            (
                "vectorstores/oceanbase.defaults",
                vector_clients,
                {"OCEANBASE_VECTOR_HOST": ("custom-oceanbase", "root-oceanbase")},
            ),
            ("vectorstores/pgvector.defaults", vector_clients, {"PGVECTOR_MIN_CONNECTION": ("2", "3")}),
            ("vectorstores/milvus.env.example", vector_clients, {"MILVUS_DATABASE": ("custom_dify", "root_dify")}),
        ]
        root = self.project / ".env"
        initial_root = root.read_text()
        for template, consumers, values in cases:
            source = f"envs/{template}"
            target = source.removesuffix(".env.example").removesuffix(".defaults") + ".env"
            custom = {key: pair[0] for key, pair in values.items()}
            root_values = {key: pair[1] for key, pair in values.items()}
            with self.subTest(template=template):
                try:
                    # Each stage changes one file; no other service override is present.
                    self.override_root(custom)
                    services = self.render()
                    for name in consumers:
                        for key, value in custom.items():
                            self.assertEqual(services[name]["environment"][key], value, f"root only: {name}.{key}")
                    root.write_text(initial_root)

                    self.copy_template(source, target, custom)
                    services = self.render()
                    for name in consumers:
                        for key, value in custom.items():
                            self.assertEqual(services[name]["environment"][key], value, f"service only: {name}.{key}")

                    self.override_root(root_values)
                    services = self.render()
                    for name in consumers:
                        for key, value in root_values.items():
                            self.assertEqual(
                                services[name]["environment"][key], value, f"root precedence: {name}.{key}"
                            )
                finally:
                    (self.project / target).unlink(missing_ok=True)
                    root.write_text(initial_root)

    def test_existing_shared_overrides_and_empty_value_cleanup(self):
        values = {
            "API_WEBSOCKET_WORKER_AMOUNT": "3",
            "CELERY_MAX_WORKERS": "5",
            "QDRANT_URL": "http://existing-qdrant:6333",
            "PGVECTOR_HOST": "existing-pgvector",
            "MILVUS_DATABASE": "existing_dify",
            "CELERY_WORKER_AMOUNT": "",
            "SERVER_WORKER_CLASS": "",
            "GUNICORN_TIMEOUT": "",
        }
        override = self.project / "envs/core-services/shared.env"
        override.write_text("\n".join(f"{key}={value}" for key, value in values.items()) + "\n")
        services = self.render()
        for name in ("api", "api_websocket", "worker", "worker_knowledge_fs_upgrade", "worker_beat"):
            for key, value in values.items():
                self.assertEqual(services[name]["environment"][key], value, f"existing override: {name}.{key}")

        # Cleaning accidental blanks in the existing file restores Docker defaults without replacing it.
        override.write_text("\n".join(f"{key}={value}" for key, value in values.items() if value) + "\n")
        services = self.render()
        self.assertEqual(services["worker"]["environment"]["CELERY_WORKER_AMOUNT"], "4")
        self.assertEqual(services["api"]["environment"]["SERVER_WORKER_CLASS"], "gevent")
        self.assertEqual(services["api"]["environment"]["GUNICORN_TIMEOUT"], "360")
        self.assertEqual(services["api_websocket"]["environment"]["API_WEBSOCKET_WORKER_AMOUNT"], "3")
        self.assertEqual(services["worker"]["environment"]["QDRANT_URL"], values["QDRANT_URL"])

    def test_service_overrides_and_root_precedence(self):
        cases = [
            (
                "infrastructure/nginx",
                "nginx",
                "NGINX_CLIENT_MAX_BODY_SIZE",
                "NGINX_CLIENT_MAX_BODY_SIZE",
                "200M",
                "300M",
            ),
            (
                "core-services/web",
                "web",
                "TOP_K_MAX_VALUE",
                "TOP_K_MAX_VALUE",
                "23",
                "24",
            ),
            (
                "core-services/sandbox",
                "sandbox",
                "SANDBOX_WORKER_TIMEOUT",
                "WORKER_TIMEOUT",
                "120",
                "121",
            ),
            (
                "core-services/plugin-daemon",
                "plugin_daemon",
                "PLUGIN_DAEMON_PORT",
                "SERVER_PORT",
                "5998",
                "5999",
            ),
            (
                "vectorstores/weaviate",
                "weaviate",
                "WEAVIATE_QUERY_DEFAULTS_LIMIT",
                "QUERY_DEFAULTS_LIMIT",
                "66",
                "67",
            ),
            (
                "core-services/api",
                "api",
                "API_SENTRY_DSN",
                "SENTRY_DSN",
                "https://api.example.test/1",
                "https://api.example.test/2",
            ),
            (
                "core-services/worker",
                "worker",
                "API_SENTRY_DSN",
                "SENTRY_DSN",
                "https://worker.example.test/1",
                "https://api.example.test/2",
            ),
            (
                "infrastructure/certbot",
                "certbot",
                "CERTBOT_DOMAIN",
                "CERTBOT_DOMAIN",
                "one.example.test",
                "two.example.test",
            ),
            (
                "vectorstores/opensearch",
                "opensearch",
                "OPENSEARCH_JAVA_OPTS_MIN",
                "OPENSEARCH_JAVA_OPTS",
                "768m",
                "896m",
            ),
        ]
        for path, _, key, _, local, _ in cases:
            self.copy_template(f"envs/{path}.defaults", f"envs/{path}.env", {key: local})
        services = self.render()
        for _, service, _, native, local, _ in cases:
            expected = f"-Xms{local} -Xmx1024m" if native == "OPENSEARCH_JAVA_OPTS" else local
            self.assertEqual(
                services[service]["environment"][native],
                expected,
                f"{service}.{native}",
            )
        self.override_root({key: value for _, _, key, _, _, value in cases})
        services = self.render()
        for _, service, _, native, _, value in cases:
            expected = f"-Xms{value} -Xmx1024m" if native == "OPENSEARCH_JAVA_OPTS" else value
            self.assertEqual(
                services[service]["environment"][native],
                expected,
                f"{service}.{native}",
            )

    def test_database_redis_overrides_reach_clients_and_commands(self):
        for name in (
            "api-worker",
            "api",
            "worker",
            "worker-beat",
            "plugin-daemon",
            "dify-agent",
        ):
            self.copy_template(f"envs/core-services/{name}.defaults", f"envs/core-services/{name}.env")
        self.copy_template(
            "envs/databases/db-postgres.defaults",
            "envs/databases/db-postgres.env",
            {
                "DB_USERNAME": "custom_user",
                "DB_PASSWORD": "test-db-password",
                "DB_DATABASE": "custom_dify",
                "POSTGRES_MAX_CONNECTIONS": "321",
            },
        )
        self.copy_template(
            "envs/databases/redis.defaults",
            "envs/databases/redis.env",
            {"REDIS_PASSWORD": "test-redis-password"},
        )
        services = self.render()
        for name in ("api", "worker", "worker_beat", "plugin_daemon"):
            values = services[name]["environment"]
            self.assertEqual(values["DB_USERNAME"], "custom_user", name)
            self.assertEqual(values["DB_PASSWORD"], "test-db-password", name)
            self.assertEqual(values["REDIS_PASSWORD"], "test-redis-password", name)
        for name in ("api", "worker", "worker_beat"):
            self.assertEqual(
                services[name]["environment"]["CELERY_BROKER_URL"],
                "redis://:test-redis-password@redis:6379/1",
                name,
            )
        self.assertEqual(
            services["db_postgres"]["environment"]["POSTGRES_PASSWORD"],
            "test-db-password",
        )
        self.assertEqual(services["plugin_daemon"]["environment"]["DB_DATABASE"], "dify_plugin")
        self.assertEqual(services["redis"]["environment"]["REDISCLI_AUTH"], "test-redis-password")
        self.assertEqual(
            services["agent_backend"]["environment"]["DIFY_AGENT_REDIS_URL"],
            "redis://:test-redis-password@redis:6379/2",
        )
        # Execute the command with a harmless stand-in for the image entrypoint.
        executable = self.project / "docker-entrypoint.sh"
        executable.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
        executable.chmod(0o755)
        for service in ("db_postgres", "db_mysql", "redis"):
            config = services[service]
            command = [arg.replace("$$", "$") for arg in config["command"]]
            env = {
                **config["environment"],
                "PATH": f"{self.project}:{os.environ['PATH']}",
            }
            if service == "redis":
                env["REDIS_PASSWORD"] = "literal $(touch should-not-exist) ; password"
            result = subprocess.run(
                command,
                cwd=self.project,
                env=env,
                text=True,
                capture_output=True,
                check=True,
            )
            args = result.stdout.splitlines()
            self.assertEqual(
                args[0],
                {
                    "db_postgres": "postgres",
                    "db_mysql": "mysqld",
                    "redis": "redis-server",
                }[service],
            )
            if service == "db_postgres":
                self.assertIn("max_connections=321", args)
            if service == "redis":
                self.assertEqual(args[-1], env["REDIS_PASSWORD"])
            self.assertFalse((self.project / "should-not-exist").exists())

    def test_root_plugin_credentials_reach_every_consumer(self):
        for name in ("api-worker", "api", "worker", "worker-beat", "plugin-daemon", "dify-agent"):
            self.copy_template(f"envs/core-services/{name}.defaults", f"envs/core-services/{name}.env")
        api_services = (
            "api",
            "api_websocket",
            "worker",
            "worker_knowledge_fs_upgrade",
            "knowledge_fs_document_worker",
            "knowledge_fs_source_worker",
            "knowledge_fs_research_worker",
            "knowledge_fs_maintenance_worker",
            "knowledge_fs_dispatch_worker",
        )
        cases = {
            "PLUGIN_DAEMON_KEY": {
                **dict.fromkeys((*api_services, "worker_beat"), "PLUGIN_DAEMON_KEY"),
                "plugin_daemon": "SERVER_KEY",
                "agent_backend": "DIFY_AGENT_PLUGIN_DAEMON_API_KEY",
            },
            "PLUGIN_DIFY_INNER_API_KEY": {
                **dict.fromkeys(api_services, "INNER_API_KEY_FOR_PLUGIN"),
                "plugin_daemon": "DIFY_INNER_API_KEY",
                "agent_backend": "DIFY_AGENT_INNER_API_KEY",
                "knowledge_fs": "DIFY_INNER_API_KEY",
            },
        }
        for key, consumers in cases.items():
            value = f"custom-{key.lower()}"
            self.override_root({key: value})
            services = self.render()
            for name, native in consumers.items():
                self.assertEqual(services[name]["environment"][native], value, f"{name}.{native}")
            if key == "PLUGIN_DIFY_INNER_API_KEY":
                for name in api_services:
                    if name.startswith("knowledge_fs_"):
                        self.assertEqual(services[name]["environment"]["DIFY_INNER_API_KEY"], value, name)

    def test_websocket_uses_copied_api_settings(self):
        self.copy_template(
            "envs/core-services/api.defaults",
            "envs/core-services/api.env",
            {"API_WEBSOCKET_WORKER_AMOUNT": "3"},
        )
        config = self.render()["api_websocket"]
        # Stand in for the image's entrypoint; exercise the actual shell expansion.
        command = [arg.replace("$$", "$") for arg in config["entrypoint"]]
        command[-1] = command[-1].replace("exec /bin/bash /entrypoint.sh", 'printf "%s" "$SERVER_WORKER_AMOUNT"')
        result = subprocess.run(
            command,
            env=config["environment"],
            text=True,
            capture_output=True,
            check=True,
        )
        self.assertEqual(result.stdout, "3")

    def test_e2b_overlay_preserves_service_credentials(self):
        self.copy_template("docker-compose.e2b.yaml", "docker-compose.e2b.yaml")
        self.copy_template(
            "envs/core-services/dify-agent.defaults",
            "envs/core-services/dify-agent.env",
            {
                "DIFY_AGENT_E2B_API_KEY": "service-api-key",
                "DIFY_AGENT_E2B_TEMPLATE": "custom-template",
            },
        )
        values = self.render("-f", "docker-compose.yaml", "-f", "docker-compose.e2b.yaml")["agent_backend"][
            "environment"
        ]
        self.assertEqual(values["DIFY_AGENT_RUNTIME_BACKEND"], "e2b")
        self.assertEqual(values["DIFY_AGENT_E2B_API_KEY"], "service-api-key")
        self.assertEqual(values["DIFY_AGENT_E2B_TEMPLATE"], "custom-template")

    def test_generator_creates_only_root_env_and_preserves_edits(self):
        for source in (
            "generate_docker_compose",
            ".env.example",
            "docker-compose-template.yaml",
            "envs/security.env.example",
        ):
            self.copy_template(source, source)
        (self.project / ".env").unlink()
        command = [sys.executable, str(self.project / "generate_docker_compose")]
        subprocess.run(command, check=True, capture_output=True)
        self.assertEqual(
            (self.project / ".env").read_text(),
            (DOCKER_DIR / ".env.example").read_text(),
        )
        self.assertEqual(list((self.project / "envs").rglob("*.env")), [])
        (self.project / ".env").write_text("COMPOSE_PROFILES=custom\n")
        subprocess.run(command, check=True, capture_output=True)
        self.assertEqual((self.project / ".env").read_text(), "COMPOSE_PROFILES=custom\n")

    def test_runtime_secrets_stay_in_their_service(self):
        self.copy_template(
            "envs/core-services/api.defaults",
            "envs/core-services/api.env",
            {"PASSWORD_PEPPER": "api-only-test-secret"},
        )
        self.copy_template(
            "envs/core-services/web.defaults",
            "envs/core-services/web.env",
            {"NEXT_PUBLIC_ENABLE_HITL_IM": "true"},
        )
        services = self.render()
        self.assertEqual(services["web"]["environment"]["NEXT_PUBLIC_ENABLE_HITL_IM"], "true")
        self.assertEqual(services["api"]["environment"]["PASSWORD_PEPPER"], "api-only-test-secret")
        for name in ("web", "plugin_daemon", "nginx", "db_postgres", "agent_backend"):
            self.assertNotIn("PASSWORD_PEPPER", services[name]["environment"], name)

    def test_generated_compose_matches_template(self):
        self.assertTrue(
            (DOCKER_DIR / "docker-compose.yaml")
            .read_text()
            .endswith((DOCKER_DIR / "docker-compose-template.yaml").read_text())
        )


if __name__ == "__main__":
    unittest.main()
