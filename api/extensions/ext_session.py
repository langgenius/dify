import redis
from redis.connection import SSLConnection, Connection
from flask import request
from flask_session import Session, SqlAlchemySessionInterface, RedisSessionInterface
from flask_session.sessions import total_seconds
from itsdangerous import want_bytes

from extensions.ext_database import db

sess = Session()


def init_app(app):
    sqlalchemy_session_interface = CustomSqlAlchemySessionInterface(
        app,
        db,
        app.config.get('SESSION_SQLALCHEMY_TABLE', 'sessions'),
        app.config.get('SESSION_KEY_PREFIX', 'session:'),
        app.config.get('SESSION_USE_SIGNER', False),
        app.config.get('SESSION_PERMANENT', True)
    )

    session_type = app.config.get('SESSION_TYPE')
    if session_type == 'sqlalchemy':
        app.session_interface = sqlalchemy_session_interface
    elif session_type == 'redis':
        connection_class = Connection
        if app.config.get('SESSION_REDIS_USE_SSL', False):
            connection_class = SSLConnection

        sess_redis_client = redis.Redis()
        sess_redis_client.connection_pool = redis.ConnectionPool(**{
            'host': app.config.get('SESSION_REDIS_HOST', 'localhost'),
            'port': app.config.get('SESSION_REDIS_PORT', 6379),
            'username': app.config.get('SESSION_REDIS_USERNAME', None),
            'password': app.config.get('SESSION_REDIS_PASSWORD', None),
            'db': app.config.get('SESSION_REDIS_DB', 2),
            'encoding': 'utf-8',
            'encoding_errors': 'strict',
            'decode_responses': False
        }, connection_class=connection_class)

        app.extensions['session_redis'] = sess_redis_client

        app.session_interface = CustomRedisSessionInterface(
            sess_redis_client,
            app.config.get('SESSION_KEY_PREFIX', 'session:'),
            app.config.get('SESSION_USE_SIGNER', False),
            app.config.get('SESSION_PERMANENT', True)
        )


class CustomSqlAlchemySessionInterface(SqlAlchemySessionInterface):

    def __init__(
        self,
        app,
        db,
        table,
        key_prefix,
        use_signer=False,
        permanent=True,
        sequence=None,
        autodelete=False,
    ):
        if db is None:
            from flask_sqlalchemy import SQLAlchemy

            db = SQLAlchemy(app)
        self.db = db
        self.key_prefix = key_prefix
        self.use_signer = use_signer
        self.permanent = permanent
        self.autodelete = autodelete
        self.sequence = sequence
        self.has_same_site_capability = hasattr(self, "get_cookie_samesite")

        class Session(self.db.Model):
            __tablename__ = table

            if sequence:
                id = self.db.Column(  # noqa: A003, VNE003, A001
                    self.db.Integer, self.db.Sequence(sequence), primary_key=True
                )
            else:
                id = self.db.Column(  # noqa: A003, VNE003, A001
                    self.db.Integer, primary_key=True
                )

            session_id = self.db.Column(self.db.String(255), unique=True)
            data = self.db.Column(self.db.LargeBinary)
            expiry = self.db.Column(self.db.DateTime)

            def __init__(self, session_id, data, expiry):
                self.session_id = session_id
                self.data = data
                self.expiry = expiry

            def __repr__(self):
                return f"<Session data {self.data}>"

        self.sql_session_model = Session

    def save_session(self, *args, **kwargs):
        if request.blueprint == 'service_api':
            return
        elif request.method == 'OPTIONS':
            return
        elif request.endpoint and request.endpoint == 'health':
            return
        return super().save_session(*args, **kwargs)


class CustomRedisSessionInterface(RedisSessionInterface):

    def save_session(self, app, session, response):
        if request.blueprint == 'service_api':
            return
        elif request.method == 'OPTIONS':
            return
        elif request.endpoint and request.endpoint == 'health':
            return

        if not self.should_set_cookie(app, session):
            return
        domain = self.get_cookie_domain(app)
        path = self.get_cookie_path(app)
        if not session:
            if session.modified:
                self.redis.delete(self.key_prefix + session.sid)
                response.delete_cookie(
                    app.config["SESSION_COOKIE_NAME"], domain=domain, path=path
                )
            return

        # Modification case.  There are upsides and downsides to
        # emitting a set-cookie header each request.  The behavior
        # is controlled by the :meth:`should_set_cookie` method
        # which performs a quick check to figure out if the cookie
        # should be set or not.  This is controlled by the
        # SESSION_REFRESH_EACH_REQUEST config flag as well as
        # the permanent flag on the session itself.
        # if not self.should_set_cookie(app, session):
        #    return
        conditional_cookie_kwargs = {}
        httponly = self.get_cookie_httponly(app)
        secure = self.get_cookie_secure(app)
        if self.has_same_site_capability:
            conditional_cookie_kwargs["samesite"] = self.get_cookie_samesite(app)
        expires = self.get_expiration_time(app, session)

        if session.permanent:
            value = self.serializer.dumps(dict(session))
            if value is not None:
                self.redis.setex(
                    name=self.key_prefix + session.sid,
                    value=value,
                    time=total_seconds(app.permanent_session_lifetime),
                )

        if self.use_signer:
            session_id = self._get_signer(app).sign(want_bytes(session.sid)).decode("utf-8")
        else:
            session_id = session.sid
        response.set_cookie(
            app.config["SESSION_COOKIE_NAME"],
            session_id,
            expires=expires,
            httponly=httponly,
            domain=domain,
            path=path,
            secure=secure,
            **conditional_cookie_kwargs,
        )
