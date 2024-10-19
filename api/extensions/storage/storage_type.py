from enum import Enum


class StorageType(str, Enum):
    ALIYUN_OSS = "aliyun-oss"
    AZURE_BLOB = "azure-blob"
    BAIDU_OBS = "baidu-obs"
    GOOGLE_STORAGE = "google-storage"
    HUAWEI_OBS = "huawei-obs"
    LOCAL = "local"
    OCI_STORAGE = "oci-storage"
    S3 = "s3"
    TENCENT_COS = "tencent-cos"
    VOLCENGINE_TOS = "volcengine-tos"
    SUPBASE = "supabase"
