import redis
from redis.connection import Connection, SSLConnection

redis_client = redis.Redis()


def init_app(app):
    connection_class = Connection
    if app.config.get('REDIS_USE_SSL', False):
        connection_class = SSLConnection

    cluster_name = app.config.get('REDIS_CLUSTER_NAME', None)
    if cluster_name:
        username = app.config.get('REDIS_USERNAME', None)
        creds_provider = ElastiCacheIAMProvider(user=username, cluster_name=cluster_name)
        redis_client.connection_pool = redis.ConnectionPool(**{
            'host': app.config.get('REDIS_HOST', 'localhost'),
            'port': app.config.get('REDIS_PORT', 6379),
            'credential_provider': creds_provider,
            'db': app.config.get('REDIS_DB', 0),
            'encoding': 'utf-8',
            'encoding_errors': 'strict',
            'decode_responses': False
        }, connection_class=connection_class)

    redis_client.connection_pool = redis.ConnectionPool(**{
        'host': app.config.get('REDIS_HOST', 'localhost'),
        'port': app.config.get('REDIS_PORT', 6379),
        'username': app.config.get('REDIS_USERNAME', None),
        'password': app.config.get('REDIS_PASSWORD', None),
        'db': app.config.get('REDIS_DB', 0),
        'encoding': 'utf-8',
        'encoding_errors': 'strict',
        'decode_responses': False
    }, connection_class=connection_class)

    app.extensions['redis'] = redis_client


class ElastiCacheIAMProvider(redis.CredentialProvider):
    def __init__(self, user, cluster_name, region="us-east-1"):
        self.user = user
        self.cluster_name = cluster_name
        self.region = region

        session = botocore.session.get_session()
        self.request_signer = RequestSigner(
            ServiceId("elasticache"),
            self.region,
            "elasticache",
            "v4",
            session.get_credentials(),
            session.get_component("event_emitter"),
        )

    # Generated IAM tokens are valid for 15 minutes
    @cached(cache=TTLCache(maxsize=128, ttl=900))
    def get_credentials(self) -> Union[Tuple[str], Tuple[str, str]]:
        query_params = {"Action": "connect", "User": self.user}
        url = urlunparse(
            ParseResult(
                scheme="https",
                netloc=self.cluster_name,
                path="/",
                query=urlencode(query_params),
                params="",
                fragment="",
            )
        )
        signed_url = self.request_signer.generate_presigned_url(
            {"method": "GET", "url": url, "body": {}, "headers": {}, "context": {}},
            operation_name="connect",
            expires_in=900,
            region_name=self.region,
        )
        # RequestSigner only seems to work if the URL has a protocol, but
        # Elasticache only accepts the URL without a protocol
        # So strip it off the signed URL before returning
        return (self.user, signed_url.removeprefix("https://"))