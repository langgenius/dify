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

    def render(self, *compose_args, all_profiles=True):
        inputs = set(re.findall(r"\$\{(\w+)", (DOCKER_DIR / "docker-compose.yaml").read_text()))
        for source in (DOCKER_DIR / "envs").rglob("*.defaults"):
            inputs.update(re.findall(r"\$\{(\w+)", source.read_text()))
        env = {key: value for key, value in os.environ.items() if key not in inputs and not key.startswith("COMPOSE_")}
        result = subprocess.run(
            [
                "docker",
                "compose",
                *compose_args,
                *(["--profile", "*"] if all_profiles else []),
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

    def test_qdrant_nofile_limits_use_defaults_and_root_overrides(self):
        services = self.render()
        self.assertEqual(
            services["qdrant"]["ulimits"]["nofile"],
            {"soft": 524288, "hard": 524288},
        )
        for name in ("qdrant", "api"):
            self.assertNotIn("QDRANT_NOFILE_SOFT", services[name]["environment"], name)
            self.assertNotIn("QDRANT_NOFILE_HARD", services[name]["environment"], name)

        self.override_root(
            {
                "QDRANT_NOFILE_SOFT": "65536",
                "QDRANT_NOFILE_HARD": "131072",
            }
        )
        services = self.render()
        self.assertEqual(
            services["qdrant"]["ulimits"]["nofile"],
            {"soft": 65536, "hard": 131072},
        )
        self.assertNotIn("QDRANT_NOFILE_SOFT", services["qdrant"]["environment"])
        self.assertNotIn("QDRANT_NOFILE_HARD", services["qdrant"]["environment"])

    def test_documented_mysql_root_configuration_reaches_database_clients(self):
        values = {
            "DB_TYPE": "mysql",
            "DB_HOST": "db_mysql",
            "DB_PORT": "3306",
            "DB_USERNAME": "root",
            "DB_PASSWORD": "mysql-root-override",
        }
        self.override_root({**values, "COMPOSE_PROFILES": "weaviate,mysql,collaboration"})
        services = self.render()
        for name in ("api", "api_websocket", "worker", "worker_knowledge_fs_upgrade", "worker_beat", "plugin_daemon"):
            for key, expected in values.items():
                self.assertEqual(services[name]["environment"][key], expected, f"{name}.{key}")
        self.assertEqual(services["db_mysql"]["environment"]["MYSQL_ROOT_PASSWORD"], values["DB_PASSWORD"])
        self.assertEqual(services["db_mysql"]["environment"]["MYSQL_DATABASE"], "dify")

    def test_code_sandbox_credentials_must_be_configured_as_a_pair(self):
        clients = ("api", "api_websocket", "worker", "worker_knowledge_fs_upgrade", "worker_beat")
        for source, target, key in (
            ("core-services/sandbox.defaults", "core-services/sandbox.env", "SANDBOX_API_KEY"),
            ("security.env.example", "security.env", "CODE_EXECUTION_API_KEY"),
        ):
            with self.subTest(source=source):
                self.copy_template(f"envs/{source}", f"envs/{target}", {key: "service-sandbox-key"})
                services = self.render()
                self.assertEqual(
                    services["sandbox"]["environment"]["API_KEY"],
                    "service-sandbox-key" if key == "SANDBOX_API_KEY" else "dify-sandbox",
                )
                for name in clients:
                    self.assertEqual(
                        services[name]["environment"].get("CODE_EXECUTION_API_KEY", "dify-sandbox"),
                        "service-sandbox-key" if key == "CODE_EXECUTION_API_KEY" else "dify-sandbox",
                        name,
                    )
                (self.project / "envs" / target).unlink()

        self.override_root({"SANDBOX_API_KEY": "root-sandbox-key", "CODE_EXECUTION_API_KEY": "root-sandbox-key"})
        services = self.render()
        self.assertEqual(services["sandbox"]["environment"]["API_KEY"], "root-sandbox-key")
        for name in clients:
            self.assertEqual(services[name]["environment"]["CODE_EXECUTION_API_KEY"], "root-sandbox-key", name)

    def test_root_overrides_only_reach_mapped_inputs_on_services_without_root_env_file(self):
        root = self.project / ".env"
        original = root.read_text()
        for template, target, service, local_values, root_values, expected in (
            (
                "vectorstores/weaviate.defaults",
                "vectorstores/weaviate.env",
                "weaviate",
                {"WEAVIATE_QUERY_DEFAULTS_LIMIT": "66"},
                {"WEAVIATE_QUERY_DEFAULTS_LIMIT": "67", "ASYNC_INDEXING": "true"},
                {"QUERY_DEFAULTS_LIMIT": "67", "ASYNC_INDEXING": "false"},
            ),
            (
                "core-services/knowledge-fs-unstructured.env.example",
                "core-services/knowledge-fs-unstructured.env",
                "knowledge_fs_unstructured",
                {"PDF_RENDER_DPI": "200"},
                {"PDF_RENDER_DPI": "72"},
                {"PDF_RENDER_DPI": "200"},
            ),
        ):
            with self.subTest(service=service):
                self.copy_template(f"envs/{template}", f"envs/{target}", local_values)
                local = self.project / "envs" / target
                if service == "weaviate":
                    local.write_text(local.read_text() + "\nASYNC_INDEXING=false\n")
                before = self.render()[service]["environment"]
                self.assertEqual(
                    before.get("QUERY_DEFAULTS_LIMIT", before.get("PDF_RENDER_DPI")),
                    "66" if service == "weaviate" else "200",
                )
                self.override_root(root_values)
                values = self.render()[service]["environment"]
                for key, value in expected.items():
                    self.assertEqual(values[key], value, f"{service}.{key}")
                local.unlink()
                root.write_text(original)

    def test_middleware_template_is_loaded_from_docker_directory(self):
        shutil.copyfile(DOCKER_DIR / "docker-compose.middleware.yaml", self.project / "docker-compose.middleware.yaml")
        self.copy_template(
            "envs/middleware.env.example",
            "middleware.env",
            {"DB_PASSWORD": "middleware-db-key", "EXPOSE_POSTGRES_PORT": "15432", "POSTGRES_MAX_CONNECTIONS": "121"},
        )
        services = self.render("--env-file", "middleware.env", "-f", "docker-compose.middleware.yaml", "-p", "dify")
        postgres = services["db_postgres"]
        self.assertEqual(postgres["environment"]["POSTGRES_PASSWORD"], "middleware-db-key")
        self.assertEqual(postgres["ports"][0]["published"], "15432")
        self.assertIn("max_connections=121", postgres["command"])

    def test_agent_sandbox_token_is_a_root_input_for_both_consumers(self):
        template = (DOCKER_DIR / "envs/core-services/dify-agent.defaults").read_text()
        self.assertNotRegex(template, r"(?m)^DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN=")
        self.copy_template(
            "envs/core-services/dify-agent.defaults",
            "envs/core-services/dify-agent.env",
        )
        local = self.project / "envs/core-services/dify-agent.env"
        local.write_text(local.read_text() + "\nDIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN=service-only-token\n")
        root = self.project / ".env"
        original = root.read_text()
        for setting, expected in (
            ("DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN=root-token", "root-token"),
            (
                "DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN=\nDIFY_AGENT_SHELLCTL_AUTH_TOKEN=legacy-token",
                "legacy-token",
            ),
            ("DIFY_AGENT_SHELLCTL_AUTH_TOKEN=legacy-token", "legacy-token"),
            ("DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN=", ""),
        ):
            with self.subTest(setting=setting):
                root.write_text(
                    re.sub(
                        r"(?m)^DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN=.*$",
                        setting,
                        original,
                    )
                )
                services = self.render()
                self.assertEqual(
                    services["agent_backend"]["environment"]["DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN"],
                    expected,
                )
                self.assertEqual(
                    services["local_sandbox"]["environment"]["SHELLCTL_AUTH_TOKEN"],
                    expected,
                )

    def test_legacy_agent_names_and_canonical_overrides(self):
        self.override_root({"DIFY_AGENT_SHELLCTL_ENTRYPOINT": "http://legacy-sandbox:5004", "ENABLE_AGENT_V2": "false"})
        services = self.render()
        self.assertEqual(
            services["agent_backend"]["environment"]["DIFY_AGENT_LOCAL_SANDBOX_ENDPOINT"], "http://legacy-sandbox:5004"
        )
        self.assertEqual(services["web"]["environment"]["NEXT_PUBLIC_ENABLE_AGENT_V2"], "true")
        self.override_root(
            {"DIFY_AGENT_LOCAL_SANDBOX_ENDPOINT": "http://current-sandbox:5004", "NEXT_PUBLIC_ENABLE_AGENT_V2": "false"}
        )
        services = self.render()
        self.assertEqual(
            services["agent_backend"]["environment"]["DIFY_AGENT_LOCAL_SANDBOX_ENDPOINT"], "http://current-sandbox:5004"
        )
        self.assertEqual(services["web"]["environment"]["NEXT_PUBLIC_ENABLE_AGENT_V2"], "false")
        self.override_root({"NEXT_PUBLIC_ENABLE_AGENT_V2": ""})
        self.assertEqual(self.render()["web"]["environment"]["NEXT_PUBLIC_ENABLE_AGENT_V2"], "true")

    def test_bundled_vector_defaults_and_isolated_overrides(self):
        cases = {
            "weaviate": {"WEAVIATE_ENDPOINT": "http://weaviate:8080"},
            "qdrant": {
                "QDRANT_URL": "http://qdrant:6333",
                "QDRANT_API_KEY": "difyai123456",
            },
            "oceanbase": {
                "OCEANBASE_VECTOR_HOST": "oceanbase",
                "OCEANBASE_VECTOR_USER": "root@test",
                "OCEANBASE_VECTOR_PASSWORD": "difyai123456",
                "OCEANBASE_VECTOR_DATABASE": "test",
            },
            "seekdb": {
                "OCEANBASE_VECTOR_HOST": "seekdb",
                "OCEANBASE_VECTOR_USER": "root",
                "OCEANBASE_VECTOR_PASSWORD": "difyai123456",
                "OCEANBASE_VECTOR_DATABASE": "test",
            },
            "couchbase": {
                "COUCHBASE_CONNECTION_STRING": "couchbase://couchbase-server",
                "COUCHBASE_USER": "Administrator",
                "COUCHBASE_PASSWORD": "password",
                "COUCHBASE_BUCKET_NAME": "Embeddings",
                "COUCHBASE_SCOPE_NAME": "_default",
            },
            "pgvector": {
                "PGVECTOR_HOST": "pgvector",
                "PGVECTOR_PORT": "5432",
                "PGVECTOR_USER": "postgres",
                "PGVECTOR_PASSWORD": "difyai123456",
                "PGVECTOR_DATABASE": "dify",
            },
            "pgvecto-rs": {
                "PGVECTO_RS_HOST": "pgvecto-rs",
                "PGVECTO_RS_PORT": "5432",
                "PGVECTO_RS_USER": "postgres",
                "PGVECTO_RS_PASSWORD": "difyai123456",
                "PGVECTO_RS_DATABASE": "dify",
            },
            "vastbase": {
                "VASTBASE_HOST": "vastbase",
                "VASTBASE_PORT": "5432",
                "VASTBASE_USER": "dify",
                "VASTBASE_PASSWORD": "Difyai123456",
                "VASTBASE_DATABASE": "dify",
            },
            "chroma": {
                "CHROMA_HOST": "chroma",
                "CHROMA_AUTH_CREDENTIALS": "difyai123456",
                "CHROMA_AUTH_PROVIDER": "chromadb.auth.token_authn.TokenAuthClientProvider",
            },
            "iris": {"IRIS_HOST": "iris"},
            "oracle": {
                "ORACLE_DSN": "oracle:1521/FREEPDB1",
                "ORACLE_USER": "dify",
                "ORACLE_PASSWORD": "dify",
            },
            "milvus": {
                "MILVUS_URI": "http://milvus-standalone:19530",
                "MILVUS_USER": "root",
                "MILVUS_PASSWORD": "Milvus",
                "MILVUS_DATABASE": "default",
            },
            "opensearch": {
                "OPENSEARCH_HOST": "opensearch",
                "OPENSEARCH_USER": "admin",
                "OPENSEARCH_PASSWORD": "Qazwsxedc!@#123",
                "OPENSEARCH_SECURE": "true",
                "OPENSEARCH_VERIFY_CERTS": "true",
            },
            "opengauss": {
                "OPENGAUSS_HOST": "opengauss",
                "OPENGAUSS_USER": "postgres",
                "OPENGAUSS_PASSWORD": "Dify@123",
                "OPENGAUSS_DATABASE": "dify",
            },
            "myscale": {
                "MYSCALE_HOST": "myscale",
                "MYSCALE_PORT": "8123",
                "MYSCALE_USER": "default",
                "MYSCALE_PASSWORD": "",
                "MYSCALE_DATABASE": "dify",
            },
            "matrixone": {
                "MATRIXONE_HOST": "matrixone",
                "MATRIXONE_PORT": "6001",
                "MATRIXONE_USER": "dump",
                "MATRIXONE_PASSWORD": "111",
                "MATRIXONE_DATABASE": "dify",
            },
            "elasticsearch": {
                "ELASTICSEARCH_HOST": "elasticsearch",
                "ELASTICSEARCH_PASSWORD": "elastic",
            },
            "elasticsearch-ja": {
                "ELASTICSEARCH_HOST": "elasticsearch",
                "ELASTICSEARCH_PASSWORD": "elastic",
            },
        }
        consumers = (
            "api",
            "api_websocket",
            "worker",
            "worker_knowledge_fs_upgrade",
            "worker_beat",
        )
        root = self.project / ".env"
        original = root.read_text()
        for provider, expected in cases.items():
            with self.subTest(provider=provider):
                root.write_text(original)
                self.override_root(
                    {
                        "VECTOR_STORE": provider,
                        "COMPOSE_PROFILES": f"{provider},postgresql,collaboration",
                    }
                )
                selected = root.read_text()
                template = "elasticsearch" if provider == "elasticsearch-ja" else provider
                source = f"envs/vectorstores/{template}.defaults"
                target = f"envs/vectorstores/{template}.env"
                key = next(iter(expected))
                try:
                    baseline = self.render()
                    for name in consumers:
                        for variable, value in expected.items():
                            self.assertEqual(
                                baseline[name]["environment"].get(variable),
                                value,
                                f"{name}.{variable}",
                            )
                        server = {
                            "milvus": "milvus-standalone",
                            "couchbase": "couchbase-server",
                            "elasticsearch-ja": "elasticsearch",
                        }.get(provider, provider)
                        self.assertTrue(
                            set(baseline[name]["networks"]) & set(baseline[server]["networks"]),
                            name,
                        )

                    # Change only the root file, then restore it before exercising the provider file.
                    self.override_root({key: "root-only"})
                    root_only = self.render()
                    for name in consumers:
                        self.assertEqual(root_only[name]["environment"][key], "root-only", name)
                    root.write_text(selected)

                    self.copy_template(source, target)
                    copied = self.render()
                    for name in consumers:
                        for variable, value in expected.items():
                            self.assertEqual(
                                copied[name]["environment"][variable],
                                value,
                                f"copy: {name}.{variable}",
                            )
                    self.copy_template(source, target, {key: "provider-only"})
                    customized = self.render()
                    for name in consumers:
                        self.assertEqual(customized[name]["environment"][key], "provider-only", name)

                    self.override_root({key: "root-wins"})
                    overridden = self.render()
                    for name in consumers:
                        self.assertEqual(overridden[name]["environment"][key], "root-wins", name)
                finally:
                    (self.project / target).unlink(missing_ok=True)
                    root.write_text(original)

    def test_external_opensearch_tls_verification_and_overrides(self):
        self.override_root(
            {
                "VECTOR_STORE": "opensearch",
                "COMPOSE_PROFILES": "postgresql,collaboration",
                "OPENSEARCH_HOST": "search.example.test",
                "OPENSEARCH_PORT": "443",
                "OPENSEARCH_SECURE": "true",
            }
        )
        root = self.project / ".env"
        original = root.read_text()
        source = "envs/vectorstores/opensearch.defaults"
        target = "envs/vectorstores/opensearch.env"

        def assert_verification(expected):
            services = self.render(all_profiles=False)
            self.assertNotIn("opensearch", services)
            for name in ("api", "api_websocket", "worker", "worker_beat"):
                values = services[name]["environment"]
                self.assertEqual(values["OPENSEARCH_HOST"], "search.example.test", name)
                self.assertEqual(values["OPENSEARCH_SECURE"], "true", name)
                self.assertEqual(values["OPENSEARCH_VERIFY_CERTS"], expected, name)

        assert_verification("true")
        self.copy_template(source, target)
        assert_verification("true")
        self.copy_template(source, target, {"OPENSEARCH_VERIFY_CERTS": "false"})
        assert_verification("false")
        self.override_root({"OPENSEARCH_VERIFY_CERTS": "true"})
        assert_verification("true")
        root.write_text(original)
        assert_verification("false")
        (self.project / target).unlink()
        assert_verification("true")
        self.override_root({"OPENSEARCH_VERIFY_CERTS": "false"})
        assert_verification("false")

    def test_weaviate_connections_survive_selecting_another_vector_store(self):
        self.override_root({"VECTOR_STORE": "qdrant", "COMPOSE_PROFILES": "weaviate,qdrant,postgresql,collaboration"})
        root = self.project / ".env"
        original = root.read_text()
        defaults = {
            "WEAVIATE_ENDPOINT": "http://weaviate:8080",
            "WEAVIATE_API_KEY": "WVF5YThaHlkYwhGUSmCRgsX3tD5ngdN8pkih",
            "WEAVIATE_GRPC_ENDPOINT": "grpc://weaviate:50051",
        }
        custom = {
            "WEAVIATE_ENDPOINT": "https://existing-weaviate:443",
            "WEAVIATE_API_KEY": "",
            "WEAVIATE_GRPC_ENDPOINT": "",
        }
        root_values = {
            "WEAVIATE_ENDPOINT": "https://root-weaviate:443",
            "WEAVIATE_API_KEY": "root-weaviate-key",
            "WEAVIATE_GRPC_ENDPOINT": "grpcs://root-weaviate:443",
        }

        def assert_connections(expected):
            services = self.render()
            for name in ("api", "api_websocket", "worker", "worker_knowledge_fs_upgrade", "worker_beat"):
                values = services[name]["environment"]
                self.assertEqual(values["VECTOR_STORE"], "qdrant", name)
                self.assertEqual(values["QDRANT_URL"], "http://qdrant:6333", name)
                for key, value in expected.items():
                    self.assertEqual(values.get(key), value, f"{name}.{key}")

        active = self.render(all_profiles=False)
        self.assertIn("weaviate", active)
        self.assertIn("qdrant", active)
        assert_connections(defaults)
        for source, target in (
            ("core-services/api-worker.defaults", "core-services/api-worker.env"),
            ("core-services/api-worker.defaults", "core-services/shared.env"),
            ("vectorstores/weaviate.defaults", "vectorstores/weaviate.env"),
        ):
            with self.subTest(source=target):
                try:
                    self.copy_template(f"envs/{source}", f"envs/{target}")
                    assert_connections(defaults)
                    self.copy_template(f"envs/{source}", f"envs/{target}", custom)
                    assert_connections(custom)
                    self.override_root(root_values)
                    assert_connections(root_values)
                    root.write_text(original)
                    assert_connections(custom)
                finally:
                    (self.project / "envs" / target).unlink(missing_ok=True)
                    root.write_text(original)
        assert_connections(defaults)
        self.override_root(root_values)
        assert_connections(root_values)

    def test_selected_vector_defaults_preserve_credentials_and_existing_overrides(self):
        root = self.project / ".env"
        original = root.read_text()
        cases = (
            ("qdrant", "QDRANT_API_KEY", "QDRANT_API_KEY", "qdrant", "QDRANT__SERVICE__API_KEY"),
            ("pgvector", "PGVECTOR_PGUSER", "PGVECTOR_USER", "pgvector", "POSTGRES_USER"),
            ("pgvector", "PGVECTOR_POSTGRES_DB", "PGVECTOR_DATABASE", "pgvector", "POSTGRES_DB"),
            ("pgvecto-rs", "PGVECTOR_PGUSER", "PGVECTO_RS_USER", "pgvecto-rs", "POSTGRES_USER"),
            ("pgvecto-rs", "PGVECTOR_POSTGRES_DB", "PGVECTO_RS_DATABASE", "pgvecto-rs", "POSTGRES_DB"),
            (
                "pgvector",
                "PGVECTOR_POSTGRES_PASSWORD",
                "PGVECTOR_PASSWORD",
                "pgvector",
                "POSTGRES_PASSWORD",
            ),
            (
                "pgvecto-rs",
                "PGVECTOR_POSTGRES_PASSWORD",
                "PGVECTO_RS_PASSWORD",
                "pgvecto-rs",
                "POSTGRES_PASSWORD",
            ),
            (
                "chroma",
                "CHROMA_SERVER_AUTHN_CREDENTIALS",
                "CHROMA_AUTH_CREDENTIALS",
                "chroma",
                "CHROMA_SERVER_AUTHN_CREDENTIALS",
            ),
            (
                "opensearch",
                "OPENSEARCH_INITIAL_ADMIN_PASSWORD",
                "OPENSEARCH_PASSWORD",
                "opensearch",
                "OPENSEARCH_INITIAL_ADMIN_PASSWORD",
            ),
        )
        for provider, key, client_key, server, server_key in cases:
            with self.subTest(provider=provider):
                root.write_text(original)
                self.override_root({"VECTOR_STORE": provider})
                target = f"envs/vectorstores/{provider}.env"
                try:
                    self.copy_template(
                        f"envs/vectorstores/{provider}.defaults",
                        target,
                        {key: "provider-password"},
                    )
                    for value in ("provider-password", "root-password"):
                        if value == "root-password":
                            self.override_root({key: value})
                        services = self.render()
                        for name in ("api", "worker", "worker_beat"):
                            self.assertEqual(services[name]["environment"][client_key], value, name)
                        self.assertEqual(services[server]["environment"][server_key], value)
                finally:
                    (self.project / target).unlink(missing_ok=True)
                    root.write_text(original)

        self.override_root({"VECTOR_STORE": "qdrant"})
        legacy = self.project / "envs/core-services/shared.env"
        legacy.write_text("QDRANT_URL=http://existing-qdrant:6333\nQDRANT_API_KEY=\n")
        services = self.render()
        for name in ("api", "worker", "worker_beat"):
            values = services[name]["environment"]
            self.assertEqual(values["QDRANT_URL"], "http://existing-qdrant:6333")
            self.assertEqual(values["QDRANT_API_KEY"], "")
            self.assertEqual(values["WEAVIATE_ENDPOINT"], "http://weaviate:8080")
            self.assertNotIn("PGVECTOR_HOST", values)

        # External providers have no bundled defaults file and keep their explicit connection settings.
        root.write_text(original)
        self.override_root({"VECTOR_STORE": "relyt", "RELYT_HOST": "external-relyt"})
        self.assertEqual(self.render()["api"]["environment"]["RELYT_HOST"], "external-relyt")

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
            ("vectorstores/milvus.defaults", vector_clients, {"MILVUS_DATABASE": ("custom_dify", "root_dify")}),
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
