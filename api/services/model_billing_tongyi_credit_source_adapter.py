"""Pure reviewed Tongyi source capability factory, not runtime authority.

Old026 rows stay unchanged; new027 conformance rows bind the actual source and
its separately derived codec. Neither sample means callers must be on latest.
Any candidate implementation/status change invalidates only its own pins.
Catalog and runtime pins are actual ee396 -> Core hashes, not SDK raw hashes.
No registry, credential, configuration, network, money or storage I/O occurs.
"""

from __future__ import annotations

import hmac
import re
from dataclasses import dataclass
from typing import Never

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ModelType
from services.entities.model_billing_mapping import SourceParameterContract, model_schema_digest
from services.entities.model_billing_tongyi_mapping import (
    TONGYI_SOURCE_UIDS,
    TongyiSourceSettings,
    tongyi_source_model_type,
)

TONGYI_CREDIT_SOURCE_ADAPTER_ID = "tongyi_credit_source_v1"
TONGYI_CREDIT_SOURCE_ADAPTER_REVISION = "1"
TONGYI_CREDIT_SOURCE_PROVIDER = "langgenius/tongyi/tongyi"


class TongyiCreditSourceAdapterError(ValueError):
    """Fixed safe denial; unknown settings/schema never authorize a route."""


@dataclass(frozen=True, slots=True)
class TongyiCreditSourceContract(SourceParameterContract):
    """An exact immutable reviewed profile, not a routing authorization."""


_REVIEWED_CONTRACTS = (
    TongyiCreditSourceContract(
        profile_id="tongyi0226-native-v1:qwen-flash",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.26@6c75a6b95954ef3c97f0d3225bad7cbfbff7cdbc82d9425074aae121cc056a64",
        source_model="qwen-flash",
        source_schema_digest="sha256:01076eeb97441093f831aeda1ae9d9e061af17c41d56f685245b606254055728",
        source_runtime_schema_digest="sha256:01076eeb97441093f831aeda1ae9d9e061af17c41d56f685245b606254055728",
        target_model="qwen-flash",
        rules_digest="sha256:76e372647cd17493eb5c4b069c8ae0a36808c58a4db2e91c5ac2fc50eb55de81",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0226-native-v1:qwen-max",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.26@6c75a6b95954ef3c97f0d3225bad7cbfbff7cdbc82d9425074aae121cc056a64",
        source_model="qwen-max",
        source_schema_digest="sha256:b9f7f7ca313d9f569d67dfd533d87a96c27a9a6883428e7feb737fdd21a1685e",
        source_runtime_schema_digest="sha256:b9f7f7ca313d9f569d67dfd533d87a96c27a9a6883428e7feb737fdd21a1685e",
        target_model="qwen-max",
        rules_digest="sha256:70e2f25c0093e9caeb9bf60846b4004384f61ba5868afae6695bde9a756cab7a",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0226-native-v1:qwen-plus",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.26@6c75a6b95954ef3c97f0d3225bad7cbfbff7cdbc82d9425074aae121cc056a64",
        source_model="qwen-plus",
        source_schema_digest="sha256:1af549f6d4494307b6a649e8f158b7b3eccc8b577646ca30eff2b4ffb3cf341e",
        source_runtime_schema_digest="sha256:1af549f6d4494307b6a649e8f158b7b3eccc8b577646ca30eff2b4ffb3cf341e",
        target_model="qwen-plus",
        rules_digest="sha256:e39023747abf882a29674847867842ec1789a29dc28d93d0bb67427c04f688f6",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0226-native-v1:qwen-plus-latest",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.26@6c75a6b95954ef3c97f0d3225bad7cbfbff7cdbc82d9425074aae121cc056a64",
        source_model="qwen-plus-latest",
        source_schema_digest="sha256:3023532c5ded50d6390b98662440ff9c24d18db8dac913ed9733643d545eef40",
        source_runtime_schema_digest="sha256:3023532c5ded50d6390b98662440ff9c24d18db8dac913ed9733643d545eef40",
        target_model="qwen-plus-latest",
        rules_digest="sha256:4b26a51d8ea74dcdca559aa53f7fc03ef5c3234a4467b141f1ce5c52fee79924",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0226-native-v1:qwen3-vl-plus",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.26@6c75a6b95954ef3c97f0d3225bad7cbfbff7cdbc82d9425074aae121cc056a64",
        source_model="qwen3-vl-plus",
        source_schema_digest="sha256:73a4db323175d4dd5eaf798001e58747026758c7290a78b064ff159af9c2df9e",
        source_runtime_schema_digest="sha256:73a4db323175d4dd5eaf798001e58747026758c7290a78b064ff159af9c2df9e",
        target_model="qwen3-vl-plus",
        rules_digest="sha256:cca4007ce937760f78f5828c25af0358f6a033c546f94bdd5f9635aed34654ba",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0226-native-v1:qwen3.5-flash",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.26@6c75a6b95954ef3c97f0d3225bad7cbfbff7cdbc82d9425074aae121cc056a64",
        source_model="qwen3.5-flash",
        source_schema_digest="sha256:302cd5c06134f726337a8556ce3801d130253369df0a3f52675d1a1481657c91",
        source_runtime_schema_digest="sha256:302cd5c06134f726337a8556ce3801d130253369df0a3f52675d1a1481657c91",
        target_model="qwen3.5-flash",
        rules_digest="sha256:148c3415306f71e69b6bf1e47db35c44f1d672755539340e97acf69b509e733b",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0226-native-v1:qwen3.5-plus",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.26@6c75a6b95954ef3c97f0d3225bad7cbfbff7cdbc82d9425074aae121cc056a64",
        source_model="qwen3.5-plus",
        source_schema_digest="sha256:cac46022dd48f0038e3ba70a19074c68798af9f8e93750612334cf8c294eaf29",
        source_runtime_schema_digest="sha256:cac46022dd48f0038e3ba70a19074c68798af9f8e93750612334cf8c294eaf29",
        target_model="qwen3.5-plus",
        rules_digest="sha256:c63ee23016e3f7f3eb37ef9dc5cf7bbaa6925760d3902aa8350be16669301255",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0226-native-v1:qwen3.6-flash",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.26@6c75a6b95954ef3c97f0d3225bad7cbfbff7cdbc82d9425074aae121cc056a64",
        source_model="qwen3.6-flash",
        source_schema_digest="sha256:31fef27ab30db92f83d1c13b2dbf0673127bd791d5ac1d578043ea9287198a3f",
        source_runtime_schema_digest="sha256:31fef27ab30db92f83d1c13b2dbf0673127bd791d5ac1d578043ea9287198a3f",
        target_model="qwen3.6-flash",
        rules_digest="sha256:a6eab516e4c313ad8bb17864be07e55dd8604b39db39e760b04cb4e7ea57a7be",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0226-native-v1:qwen3.6-plus",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.26@6c75a6b95954ef3c97f0d3225bad7cbfbff7cdbc82d9425074aae121cc056a64",
        source_model="qwen3.6-plus",
        source_schema_digest="sha256:d741072e0bb712faf4bbe5dea17e2d2ae14aa90a99fc9b31802f246b95c5d376",
        source_runtime_schema_digest="sha256:d741072e0bb712faf4bbe5dea17e2d2ae14aa90a99fc9b31802f246b95c5d376",
        target_model="qwen3.6-plus",
        rules_digest="sha256:adf2f23bc985e1b9d4130d22dc1e070d6274a7bd592bb52a0269aa601f230d52",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0226-native-v1:qwen3.7-max",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.26@6c75a6b95954ef3c97f0d3225bad7cbfbff7cdbc82d9425074aae121cc056a64",
        source_model="qwen3.7-max",
        source_schema_digest="sha256:57d0599fffbea60e082a200cb1e6ddfaa55faf600caadfae9ee60a943a46d22b",
        source_runtime_schema_digest="sha256:57d0599fffbea60e082a200cb1e6ddfaa55faf600caadfae9ee60a943a46d22b",
        target_model="qwen3.7-max",
        rules_digest="sha256:ab030b1966fe1d67387f5b6f058255cd2e871d27c7c37058204bda20b31d4784",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0226-native-v1:qwen3.7-plus",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.26@6c75a6b95954ef3c97f0d3225bad7cbfbff7cdbc82d9425074aae121cc056a64",
        source_model="qwen3.7-plus",
        source_schema_digest="sha256:218b2d7e7cde9b20bad802f1974f78373d999fc87606f72e8ac81ba994ab5755",
        source_runtime_schema_digest="sha256:218b2d7e7cde9b20bad802f1974f78373d999fc87606f72e8ac81ba994ab5755",
        target_model="qwen3.7-plus",
        rules_digest="sha256:98b9f2bc9b9d188eb93c2d8bb99e8f023a23bcfde36885c9dad68863aa5a8937",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0226-native-v1:qwen3-rerank",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.26@6c75a6b95954ef3c97f0d3225bad7cbfbff7cdbc82d9425074aae121cc056a64",
        source_model="qwen3-rerank",
        source_schema_digest="sha256:1b52444e737290163e2d7efc367c6883527205a21c28eefcff604dee17c10b68",
        source_runtime_schema_digest="sha256:1b52444e737290163e2d7efc367c6883527205a21c28eefcff604dee17c10b68",
        target_model="qwen3-rerank",
        rules_digest="sha256:2ecfe38e3543070549ff6aa0ae6251d373d58174a93ae18e83f5789e23ce1b98",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0226-native-v1:text-embedding-v3",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.26@6c75a6b95954ef3c97f0d3225bad7cbfbff7cdbc82d9425074aae121cc056a64",
        source_model="text-embedding-v3",
        source_schema_digest="sha256:da344ffe6edb654b34668c14fd1bb7508d5e5309515cf235fd57c3a29fc6d4c3",
        source_runtime_schema_digest="sha256:da344ffe6edb654b34668c14fd1bb7508d5e5309515cf235fd57c3a29fc6d4c3",
        target_model="text-embedding-v3",
        rules_digest="sha256:46b59814d051c72090a0e710a34a593cb26ee618c3e1a832dee245bbd72558a4",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0226-native-v1:text-embedding-v4",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.26@6c75a6b95954ef3c97f0d3225bad7cbfbff7cdbc82d9425074aae121cc056a64",
        source_model="text-embedding-v4",
        source_schema_digest="sha256:db2f60c67e60505860f6677f14c9c4cc5511be58a3fb8d4ecb8389edbd794452",
        source_runtime_schema_digest="sha256:db2f60c67e60505860f6677f14c9c4cc5511be58a3fb8d4ecb8389edbd794452",
        target_model="text-embedding-v4",
        rules_digest="sha256:537b2029ec03bf4f1514cc5be07720c3daae2d2ec7fb1cd24b3f562b73981218",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
)
_REVIEWED_0227_CONTRACTS = (
    TongyiCreditSourceContract(
        profile_id="tongyi0227-native-v1:qwen-flash",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.27@d9409c7d4e1ab9358330ee1c9897c29060f739657ec11e4aaab92f4265b376b6",
        source_model="qwen-flash",
        source_schema_digest="sha256:01076eeb97441093f831aeda1ae9d9e061af17c41d56f685245b606254055728",
        source_runtime_schema_digest="sha256:01076eeb97441093f831aeda1ae9d9e061af17c41d56f685245b606254055728",
        target_model="qwen-flash",
        rules_digest="sha256:5643b7ab465f2073fab02004e52b653711c76b15d6b55be6e5abb56c53217c67",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0227-native-v1:qwen-max",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.27@d9409c7d4e1ab9358330ee1c9897c29060f739657ec11e4aaab92f4265b376b6",
        source_model="qwen-max",
        source_schema_digest="sha256:b9f7f7ca313d9f569d67dfd533d87a96c27a9a6883428e7feb737fdd21a1685e",
        source_runtime_schema_digest="sha256:b9f7f7ca313d9f569d67dfd533d87a96c27a9a6883428e7feb737fdd21a1685e",
        target_model="qwen-max",
        rules_digest="sha256:a97cde3cbb1f95bde9f7c19d1ad642549cfbfd9a546714a3927bf400b2bde906",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0227-native-v1:qwen-plus",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.27@d9409c7d4e1ab9358330ee1c9897c29060f739657ec11e4aaab92f4265b376b6",
        source_model="qwen-plus",
        source_schema_digest="sha256:1af549f6d4494307b6a649e8f158b7b3eccc8b577646ca30eff2b4ffb3cf341e",
        source_runtime_schema_digest="sha256:1af549f6d4494307b6a649e8f158b7b3eccc8b577646ca30eff2b4ffb3cf341e",
        target_model="qwen-plus",
        rules_digest="sha256:d2210b20db601b935b8a45061521f0407b73c6a63550f62a3f43e2f133b2b050",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0227-native-v1:qwen-plus-latest",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.27@d9409c7d4e1ab9358330ee1c9897c29060f739657ec11e4aaab92f4265b376b6",
        source_model="qwen-plus-latest",
        source_schema_digest="sha256:3023532c5ded50d6390b98662440ff9c24d18db8dac913ed9733643d545eef40",
        source_runtime_schema_digest="sha256:3023532c5ded50d6390b98662440ff9c24d18db8dac913ed9733643d545eef40",
        target_model="qwen-plus-latest",
        rules_digest="sha256:8867e7c2a4291ae60203343eec7de8bf8bfaf1b4f8692e504fc33a87eb864983",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0227-native-v1:qwen3-vl-plus",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.27@d9409c7d4e1ab9358330ee1c9897c29060f739657ec11e4aaab92f4265b376b6",
        source_model="qwen3-vl-plus",
        source_schema_digest="sha256:73a4db323175d4dd5eaf798001e58747026758c7290a78b064ff159af9c2df9e",
        source_runtime_schema_digest="sha256:73a4db323175d4dd5eaf798001e58747026758c7290a78b064ff159af9c2df9e",
        target_model="qwen3-vl-plus",
        rules_digest="sha256:1b8f5d556035bd2451fde41eda20410641815f742f314a048359c24389d83ca6",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0227-native-v1:qwen3.5-flash",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.27@d9409c7d4e1ab9358330ee1c9897c29060f739657ec11e4aaab92f4265b376b6",
        source_model="qwen3.5-flash",
        source_schema_digest="sha256:302cd5c06134f726337a8556ce3801d130253369df0a3f52675d1a1481657c91",
        source_runtime_schema_digest="sha256:302cd5c06134f726337a8556ce3801d130253369df0a3f52675d1a1481657c91",
        target_model="qwen3.5-flash",
        rules_digest="sha256:367d476337a1553aa8bcdec9571a181b38e2257bb5b831d69e87bcaddaf20d13",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0227-native-v1:qwen3.5-plus",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.27@d9409c7d4e1ab9358330ee1c9897c29060f739657ec11e4aaab92f4265b376b6",
        source_model="qwen3.5-plus",
        source_schema_digest="sha256:cac46022dd48f0038e3ba70a19074c68798af9f8e93750612334cf8c294eaf29",
        source_runtime_schema_digest="sha256:cac46022dd48f0038e3ba70a19074c68798af9f8e93750612334cf8c294eaf29",
        target_model="qwen3.5-plus",
        rules_digest="sha256:ccc21b5b5b6d4f1b7b09772ad7dbb6074a28d4c5ff89ea59d8dce405bd4a0477",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0227-native-v1:qwen3.6-flash",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.27@d9409c7d4e1ab9358330ee1c9897c29060f739657ec11e4aaab92f4265b376b6",
        source_model="qwen3.6-flash",
        source_schema_digest="sha256:31fef27ab30db92f83d1c13b2dbf0673127bd791d5ac1d578043ea9287198a3f",
        source_runtime_schema_digest="sha256:31fef27ab30db92f83d1c13b2dbf0673127bd791d5ac1d578043ea9287198a3f",
        target_model="qwen3.6-flash",
        rules_digest="sha256:ca3d18675969d99619c85d7b7d83adb887a067147012d4422cbaedda926bf877",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0227-native-v1:qwen3.6-plus",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.27@d9409c7d4e1ab9358330ee1c9897c29060f739657ec11e4aaab92f4265b376b6",
        source_model="qwen3.6-plus",
        source_schema_digest="sha256:d741072e0bb712faf4bbe5dea17e2d2ae14aa90a99fc9b31802f246b95c5d376",
        source_runtime_schema_digest="sha256:d741072e0bb712faf4bbe5dea17e2d2ae14aa90a99fc9b31802f246b95c5d376",
        target_model="qwen3.6-plus",
        rules_digest="sha256:db5d8bf8f1ae77023207ff601e806012c19dbbd1ef8d2dc8ebb8489e40f3a8a1",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0227-native-v1:qwen3.7-max",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.27@d9409c7d4e1ab9358330ee1c9897c29060f739657ec11e4aaab92f4265b376b6",
        source_model="qwen3.7-max",
        source_schema_digest="sha256:57d0599fffbea60e082a200cb1e6ddfaa55faf600caadfae9ee60a943a46d22b",
        source_runtime_schema_digest="sha256:57d0599fffbea60e082a200cb1e6ddfaa55faf600caadfae9ee60a943a46d22b",
        target_model="qwen3.7-max",
        rules_digest="sha256:14d3d298fa82554e02288eaef93559a7192bc300f12b0c8e6517cd2b6218b8cd",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0227-native-v1:qwen3.7-plus",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.27@d9409c7d4e1ab9358330ee1c9897c29060f739657ec11e4aaab92f4265b376b6",
        source_model="qwen3.7-plus",
        source_schema_digest="sha256:218b2d7e7cde9b20bad802f1974f78373d999fc87606f72e8ac81ba994ab5755",
        source_runtime_schema_digest="sha256:218b2d7e7cde9b20bad802f1974f78373d999fc87606f72e8ac81ba994ab5755",
        target_model="qwen3.7-plus",
        rules_digest="sha256:af0d8e40c2e5b078b05912c36a79addce6fca356882ed52c963d2acd1cc04bc4",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0227-native-v1:text-embedding-v3",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.27@d9409c7d4e1ab9358330ee1c9897c29060f739657ec11e4aaab92f4265b376b6",
        source_model="text-embedding-v3",
        source_schema_digest="sha256:da344ffe6edb654b34668c14fd1bb7508d5e5309515cf235fd57c3a29fc6d4c3",
        source_runtime_schema_digest="sha256:da344ffe6edb654b34668c14fd1bb7508d5e5309515cf235fd57c3a29fc6d4c3",
        target_model="text-embedding-v3",
        rules_digest="sha256:ed137e61c681472f5795e310762cbb02efc0d40c224079b6d6c4e9bcd85435da",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0227-native-v1:text-embedding-v4",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.27@d9409c7d4e1ab9358330ee1c9897c29060f739657ec11e4aaab92f4265b376b6",
        source_model="text-embedding-v4",
        source_schema_digest="sha256:db2f60c67e60505860f6677f14c9c4cc5511be58a3fb8d4ecb8389edbd794452",
        source_runtime_schema_digest="sha256:db2f60c67e60505860f6677f14c9c4cc5511be58a3fb8d4ecb8389edbd794452",
        target_model="text-embedding-v4",
        rules_digest="sha256:6a3f3178b2f159c8cb5cdc701b4edf38018b33ac249b811f94993302830c19cd",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
    TongyiCreditSourceContract(
        profile_id="tongyi0227-native-v1:qwen3-rerank",
        source_plugin_unique_identifier="langgenius/tongyi:0.2.27@d9409c7d4e1ab9358330ee1c9897c29060f739657ec11e4aaab92f4265b376b6",
        source_model="qwen3-rerank",
        source_schema_digest="sha256:1b52444e737290163e2d7efc367c6883527205a21c28eefcff604dee17c10b68",
        source_runtime_schema_digest="sha256:1b52444e737290163e2d7efc367c6883527205a21c28eefcff604dee17c10b68",
        target_model="qwen3-rerank",
        rules_digest="sha256:e6989a6775de1ae4612d452f9f3697e1cf0a08f4fbef57bf49cdf7acb1d351dd",
        adapter_id="tongyi_credit_source_v1",
        algorithm_revision="1",
    ),
)
_ALL_REVIEWED_CONTRACTS = _REVIEWED_CONTRACTS + _REVIEWED_0227_CONTRACTS

_MARKER_FIELDS = frozenset(
    {
        "schema_version",
        "profile_id",
        "source_plugin_uid",
        "source_model",
        "source_schema_digest",
        "rules_digest",
    }
)


def _deny() -> Never:
    raise TongyiCreditSourceAdapterError("Tongyi source evidence is not reviewed")


def _digest(value: object) -> bool:
    return type(value) is str and re.fullmatch(r"sha256:[0-9a-f]{64}", value) is not None


def validate_tongyi_credit_source_identity(
    *,
    source_provider: str,
    source_model: str,
    source_plugin_unique_identifier: str,
    model_type: ModelType,
    target_model: str,
) -> None:
    if (
        type(source_provider) is not str
        or source_provider != TONGYI_CREDIT_SOURCE_PROVIDER
        or type(source_plugin_unique_identifier) is not str
        or source_plugin_unique_identifier not in TONGYI_SOURCE_UIDS
        or type(source_model) is not str
        or type(target_model) is not str
        or source_model != target_model
    ):
        _deny()
    try:
        expected = tongyi_source_model_type(source_model)
    except ValueError:
        _deny()
    else:
        if model_type is not expected:
            _deny()


def _settings(settings: TongyiSourceSettings, model: str) -> None:
    if type(settings) is not TongyiSourceSettings or not settings.matches_model_type(tongyi_source_model_type(model)):
        _deny()


def _schema_digest(schema: AIModelEntity, model: str) -> str:
    if (
        not isinstance(schema, AIModelEntity)
        or schema.model != model
        or schema.model_type is not tongyi_source_model_type(model)
        or schema.model_type is ModelType.LLM
        and schema.model_properties.get(ModelPropertyKey.MODE) != "chat"
    ):
        _deny()
    return model_schema_digest(schema)


def _runtime_pin(contract: TongyiCreditSourceContract, expected: str, observed: AIModelEntity | None) -> None:
    if not _digest(expected) or not hmac.compare_digest(expected, contract.source_runtime_schema_digest or ""):
        _deny()
    # None is frozen/prospective restoration, NEVER observed runtime evidence.
    if observed is not None and not hmac.compare_digest(_schema_digest(observed, contract.source_model), expected):
        _deny()


def tongyi_credit_source_marker(
    contract: TongyiCreditSourceContract,
    *,
    source_provider: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
) -> dict[str, object]:
    if type(contract) is not TongyiCreditSourceContract or contract not in _ALL_REVIEWED_CONTRACTS:
        _deny()
    validate_tongyi_credit_source_identity(
        source_provider=source_provider,
        source_model=source_model,
        source_plugin_unique_identifier=contract.source_plugin_unique_identifier,
        model_type=model_type,
        target_model=target_model,
    )
    if source_model != contract.source_model or target_model != contract.target_model:
        _deny()
    return {
        "schema_version": 1,
        "profile_id": contract.profile_id,
        "source_plugin_uid": contract.source_plugin_unique_identifier,
        "source_model": contract.source_model,
        "source_schema_digest": contract.source_schema_digest,
        "rules_digest": contract.rules_digest,
    }


def build_tongyi_credit_source_contract(
    *,
    adapter_id: str,
    adapter_revision: str,
    expected_rules_digest: str,
    source_provider: str,
    source_model: str,
    source_plugin_unique_identifier: str,
    source_schema: AIModelEntity,
    expected_source_schema_digest: str,
    expected_source_runtime_schema_digest: str,
    target_model: str,
    source_settings: TongyiSourceSettings,
    source_runtime_schema: AIModelEntity | None = None,
) -> TongyiCreditSourceContract:
    if not isinstance(source_schema, AIModelEntity):
        _deny()
    validate_tongyi_credit_source_identity(
        source_provider=source_provider,
        source_model=source_model,
        source_plugin_unique_identifier=source_plugin_unique_identifier,
        model_type=source_schema.model_type,
        target_model=target_model,
    )
    _settings(source_settings, source_model)
    actual = _schema_digest(source_schema, source_model)
    contract = next(
        (
            row
            for row in _ALL_REVIEWED_CONTRACTS
            if row.source_model == source_model
            and row.source_plugin_unique_identifier == source_plugin_unique_identifier
        ),
        None,
    )
    if (
        contract is None
        or type(adapter_id) is not str
        or adapter_id != TONGYI_CREDIT_SOURCE_ADAPTER_ID
        or type(adapter_revision) is not str
        or adapter_revision != TONGYI_CREDIT_SOURCE_ADAPTER_REVISION
        or not _digest(expected_rules_digest)
        or not _digest(expected_source_schema_digest)
        or not hmac.compare_digest(expected_rules_digest, contract.rules_digest)
        or not hmac.compare_digest(expected_source_schema_digest, actual)
        or not hmac.compare_digest(actual, contract.source_schema_digest)
    ):
        _deny()
    _runtime_pin(contract, expected_source_runtime_schema_digest, source_runtime_schema)
    return contract


def restore_tongyi_credit_source_contract(
    marker: object,
    *,
    source_provider: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
    source_settings: TongyiSourceSettings,
    expected_source_runtime_schema_digest: str,
    source_runtime_schema: AIModelEntity | None = None,
) -> TongyiCreditSourceContract:
    if (
        type(marker) is not dict
        or set(marker) != _MARKER_FIELDS
        or type(marker.get("schema_version")) is not int
        or marker.get("schema_version") != 1
        or any(type(value) is not str for key, value in marker.items() if key != "schema_version")
    ):
        _deny()
    contract = next((row for row in _ALL_REVIEWED_CONTRACTS if row.profile_id == marker["profile_id"]), None)
    if contract is None:
        _deny()
    expected = tongyi_credit_source_marker(
        contract,
        source_provider=source_provider,
        source_model=source_model,
        model_type=model_type,
        target_model=target_model,
    )
    if marker != expected:
        _deny()
    _settings(source_settings, source_model)
    _runtime_pin(contract, expected_source_runtime_schema_digest, source_runtime_schema)
    return contract
