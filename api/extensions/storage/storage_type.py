from enum import StrEnum


class StorageType(StrEnum):
    ALIYUN_OSS = "aliyun-oss"
    AZURE_BLOB = "azure-blob"
    BAIDU_OBS = "baidu-obs"
    GOOGLE_STORAGE = "google-storage"
    HUAWEI_OBS = "huawei-obs"
    LOCAL = "local"
    OCI_STORAGE = "oci-storage"
    OPENDAL = "opendal"
    S3 = "s3"
    TENCENT_COS = "tencent-cos"
    VOLCENGINE_TOS = "volcengine-tos"
    SUPBASE = "supabase"
