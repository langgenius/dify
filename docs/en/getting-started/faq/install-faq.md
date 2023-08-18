# Install FAQ

### 1. How to reset the password if the local deployment initialization fails with an incorrect password?

If deployed using docker compose, you can execute the following command to reset the password:
`docker exec -it docker-api-1 flask reset-password`
Enter the account email and twice new passwords, and it will be reset.

### 2. How to resolve File not found error in the log when deploying locally?

```
ERROR:root:Unknown Error in completion
Traceback (most recent call last):
  File "/www/wwwroot/dify/dify/api/libs/rsa.py", line 45, in decrypt
    private_key = storage.load(filepath)
  File "/www/wwwroot/dify/dify/api/extensions/ext_storage.py", line 65, in load
    raise FileNotFoundError("File not found")
FileNotFoundError: File not found
```

This error may be caused by switching deployment methods, or deleting the `api/storage/privkeys` file, which is used to encrypt large model keys and can not be reversed if lost. You can reset the encryption public and private keys with the following command:

* Docker compose deployment

```
docker exec -it docker-api-1 flask reset-encrypt-key-pair
```

* Source code startup

Enter the api directory

```
flask reset-encrypt-key-pair
```

Follow the prompts to reset.

### 3. Unable to log in when installing later, and then login is successful but subsequent interfaces prompt 401?

This may be due to switching the domain name/website, causing cross-domain between front-end and server-side. Cross-domain and identity involve two configuration items:

**CORS cross-domain configuration**

`CONSOLE_CORS_ALLOW_ORIGINS` Console CORS cross-domain policy, default to `*`, which allows access from all domain names.
`WEB_API_CORS_ALLOW_ORIGINS` WebAPP CORS cross-domain strategy, default to `*`, which allows access from all domain names.

**Cookie policy configuration**

The cookie policy is divided into three configurations `HttpOnly`, `SameSite` and `Secure`.

`HttpOnly`: Default to true, normally does not need to be modified, used to prevent XSS attacks, that is, JS can not get the content of the cookie, only carry it on Http requests.

`SameSite`: Divided into three gears, Strict, Lax and None, but because Dify needs to be able to get identity information from cookies when authorizing callback from external domains such as Github and Google, it can only be chosen between Lax and None, of which None can be completely cross-domain accessed.

`Secure`: This parameter restricts whether the server interface must be under HTTPS in order for the Cookie to be saved locally, and it must be true in cross-domain scenarios (except for localhost / 127.0.0.1 on different ports), otherwise the browser will not pass.

**Recommended Configuration**

According to the configuration description, we recommend the following configuration in these three scenarios:
1.  Local debug (default policy)
Development mode same domain policy. Support HTTP / HTTPS protocol, but need to ensure that the front-end page and interface are under the same domain.

```
WEB_API_CORS_ALLOW_ORIGINS:''
CONSOLE_CORS_ALLOW_ORIGINS: ''
COOKIE_HTTPONLY:'true'
COOKIE_SAMESITE: 'Lax'
COOKIE_SECURE: 'false'
```

2. Cross-Domain Policy (do not use in production)
Cross-domain between server and web client, server must be HTTPS. Since SameSite=None must be coupled with Secure=true, the server must be in the `HTTPS` protocol in order to cross-domain access, which can be used in the server remotely and provide `HTTPS` protocol support, or local start-up server and front-end project (localhost, but different ports, tested available, although prompt warning).

```
WEB_API_CORS_ALLOW_ORIGINS: 'https://your-domain-for-web-app'
CONSOLE_CORS_ALLOW_ORIGINS: 'https://your-domain-for-console'
COOKIE_HTTPONLY: 'true'
COOKIE_SAMESITE: 'None'
COOKIE_SECURE: 'true'
```

3.Production Policy
Strict Mode. Due to the need to support callbacks and cookies for some third-party integration, it is not possible to use the highest Strict policy, so it is necessary to strictly limit the CORS domain name and set the cookie policy to SameSite=Lax, Secure=true.

```
WEB_API_CORS_ALLOW_ORIGINS: 'https://your-domain-for-web-app'
CONSOLE_CORS_ALLOW_ORIGINS: 'https://your-domain-for-console'
COOKIE_HTTPONLY: 'true'
COOKIE_SAMESITE: 'Lax'
COOKIE_SECURE: 'true'
```

Unavailable scenarios 
When the front end and back end are cross-domain and the server-side is http protocol, no Cookie policy can support this scenario. Please adjust the back end to HTTPS protocol or set to the same domain.

### 4. After starting, the page keeps loading and checking the request prompts CORS error?

This may be because the domain name/URL has been switched, resulting in cross-domain between the front end and the back end. Please change all the following configuration items in `docker-compose.yml` to the new domain name: 
`CONSOLE_API_URL:` The backend URL of the console API.
`CONSOLE_WEB_URL:` The front-end URL of the console web.
`SERVICE_API_URL:` Service API Url
`APP_API_URL:` WebApp API backend Url.
`APP_WEB_URL:` WebApp Url.

For more information, please check out: [Environments](../install-self-hosted/environments.md)

### 5. How to upgrade version after deployment?

If you start up through images, please pull the latest images to complete the upgrade. If you start up through source code, please pull the latest code and then start up to complete the upgrade.

### 6.How to configure the environment variables when use Notion import

**Q: What is the Notion's Integration configuration address?**

A: [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)

**Q: Which environment variables need to be configured？**

A:  Please set below configuration when doing the privatized deployment

1. **`NOTION_INTEGRATION_TYPE`** : The value should configrate as (**public/internal**). Since the Redirect address of Notion’s Oauth only supports https, if it is deployed locally, please use Notion’s internal integration
2. **`NOTION_CLIENT_SECRET`** : Notion OAuth client secret  (userd for public  integration type)
3. **`NOTION_CLIENT_ID`** : OAuth client ID (userd for public  integration type)
4. **`NOTION_INTERNAL_SECRET`** : Notion Internal Integration Secret, If the value of `NOTION_INTEGRATION_TYPE` is **internal** ,you need to configure this variable.
