from collections.abc import Callable
from datetime import datetime, timezone, date, timedelta
from enum import Enum
from functools import wraps
from typing import Optional

from flask import current_app, request
from flask_login import user_logged_in
from flask_restful import Resource
from pydantic import BaseModel
from werkzeug.exceptions import Forbidden, Unauthorized

from extensions.ext_database import db
from libs.login import _get_user
from models.account import Account, Tenant, TenantAccountJoin, TenantStatus
from models.model import ApiToken, App, EndUser
from services.feature_service import FeatureService

import pandas as pd
import requests
from vnstock3 import Vnstock
from bs4 import BeautifulSoup


class WhereisUserArg(Enum):
    """
    Enum for whereis_user_arg.
    """
    QUERY = 'query'
    JSON = 'json'
    FORM = 'form'


class FetchUserArg(BaseModel):
    fetch_from: WhereisUserArg
    required: bool = False


def validate_app_token(view: Optional[Callable] = None, *, fetch_user_arg: Optional[FetchUserArg] = None):
    def decorator(view_func):
        @wraps(view_func)
        def decorated_view(*args, **kwargs):
            api_token = validate_and_get_api_token('app')

            app_model = db.session.query(App).filter(App.id == api_token.app_id).first()
            if not app_model:
                raise Forbidden("The app no longer exists.")

            if app_model.status != 'normal':
                raise Forbidden("The app's status is abnormal.")

            if not app_model.enable_api:
                raise Forbidden("The app's API service has been disabled.")

            tenant = db.session.query(Tenant).filter(Tenant.id == app_model.tenant_id).first()
            if tenant.status == TenantStatus.ARCHIVE:
                raise Forbidden("The workspace's status is archived.")

            kwargs['app_model'] = app_model

            if fetch_user_arg:
                if fetch_user_arg.fetch_from == WhereisUserArg.QUERY:
                    user_id = request.args.get('user')
                elif fetch_user_arg.fetch_from == WhereisUserArg.JSON:
                    user_id = request.get_json().get('user')
                elif fetch_user_arg.fetch_from == WhereisUserArg.FORM:
                    user_id = request.form.get('user')
                else:
                    # use default-user
                    user_id = None

                if not user_id and fetch_user_arg.required:
                    raise ValueError("Arg user must be provided.")

                if user_id:
                    user_id = str(user_id)

                kwargs['end_user'] = create_or_update_end_user_for_user_id(app_model, user_id)

            return view_func(*args, **kwargs)
        return decorated_view

    if view is None:
        return decorator
    else:
        return decorator(view)


def cloud_edition_billing_resource_check(resource: str,
                                         api_token_type: str,
                                         error_msg: str = "You have reached the limit of your subscription."):
    def interceptor(view):
        def decorated(*args, **kwargs):
            api_token = validate_and_get_api_token(api_token_type)
            features = FeatureService.get_features(api_token.tenant_id)

            if features.billing.enabled:
                members = features.members
                apps = features.apps
                vector_space = features.vector_space
                documents_upload_quota = features.documents_upload_quota

                if resource == 'members' and 0 < members.limit <= members.size:
                    raise Forbidden(error_msg)
                elif resource == 'apps' and 0 < apps.limit <= apps.size:
                    raise Forbidden(error_msg)
                elif resource == 'vector_space' and 0 < vector_space.limit <= vector_space.size:
                    raise Forbidden(error_msg)
                elif resource == 'documents' and 0 < documents_upload_quota.limit <= documents_upload_quota.size:
                    raise Forbidden(error_msg)
                else:
                    return view(*args, **kwargs)

            return view(*args, **kwargs)
        return decorated
    return interceptor


def cloud_edition_billing_knowledge_limit_check(resource: str,
                                                api_token_type: str,
                                                error_msg: str = "To unlock this feature and elevate your Dify experience, please upgrade to a paid plan."):
    def interceptor(view):
        @wraps(view)
        def decorated(*args, **kwargs):
            api_token = validate_and_get_api_token(api_token_type)
            features = FeatureService.get_features(api_token.tenant_id)
            if features.billing.enabled:
                if resource == 'add_segment':
                    if features.billing.subscription.plan == 'sandbox':
                        raise Forbidden(error_msg)
                else:
                    return view(*args, **kwargs)

            return view(*args, **kwargs)

        return decorated

    return interceptor

def validate_dataset_token(view=None):
    def decorator(view):
        @wraps(view)
        def decorated(*args, **kwargs):
            api_token = validate_and_get_api_token('dataset')
            tenant_account_join = db.session.query(Tenant, TenantAccountJoin) \
                .filter(Tenant.id == api_token.tenant_id) \
                .filter(TenantAccountJoin.tenant_id == Tenant.id) \
                .filter(TenantAccountJoin.role.in_(['owner'])) \
                .filter(Tenant.status == TenantStatus.NORMAL) \
                .one_or_none() # TODO: only owner information is required, so only one is returned.
            if tenant_account_join:
                tenant, ta = tenant_account_join
                account = Account.query.filter_by(id=ta.account_id).first()
                # Login admin
                if account:
                    account.current_tenant = tenant
                    current_app.login_manager._update_request_context_with_user(account)
                    user_logged_in.send(current_app._get_current_object(), user=_get_user())
                else:
                    raise Unauthorized("Tenant owner account does not exist.")
            else:
                raise Unauthorized("Tenant does not exist.")
            return view(api_token.tenant_id, *args, **kwargs)
        return decorated

    if view:
        return decorator(view)

    # if view is None, it means that the decorator is used without parentheses
    # use the decorator as a function for method_decorators
    return decorator


def validate_and_get_api_token(scope=None):
    """
    Validate and get API token.
    """
    auth_header = request.headers.get('Authorization')
    if auth_header is None or ' ' not in auth_header:
        raise Unauthorized("Authorization header must be provided and start with 'Bearer'")

    auth_scheme, auth_token = auth_header.split(None, 1)
    auth_scheme = auth_scheme.lower()

    if auth_scheme != 'bearer':
        raise Unauthorized("Authorization scheme must be 'Bearer'")

    api_token = db.session.query(ApiToken).filter(
        ApiToken.token == auth_token,
        ApiToken.type == scope,
    ).first()

    if not api_token:
        raise Unauthorized("Access token is invalid")

    api_token.last_used_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.session.commit()

    return api_token


def create_or_update_end_user_for_user_id(app_model: App, user_id: Optional[str] = None) -> EndUser:
    """
    Create or update session terminal based on user ID.
    """
    if not user_id:
        user_id = 'DEFAULT-USER'

    end_user = db.session.query(EndUser) \
        .filter(
        EndUser.tenant_id == app_model.tenant_id,
        EndUser.app_id == app_model.id,
        EndUser.session_id == user_id,
        EndUser.type == 'service_api'
    ).first()

    if end_user is None:
        end_user = EndUser(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            type='service_api',
            is_anonymous=True if user_id == 'DEFAULT-USER' else False,
            session_id=user_id
        )
        db.session.add(end_user)
        db.session.commit()

    return end_user


class DatasetApiResource(Resource):
    method_decorators = [validate_dataset_token]




# get stock history of the company
def get_stock_price(ticker, history=200):
    today = date.today()
    start_date = today - timedelta(days=history)
    stock = Vnstock().stock(symbol=ticker.strip(), source='TCBS')
    data = stock.quote.history(start=start_date.strftime('%Y-%m-%d'),end=today.strftime('%Y-%m-%d'))
    print(data)
    return data

# Function to safely get data and handle exceptions
def safe_get_data(func, *args, **kwargs):
    try:
        return func(*args, **kwargs)
    except Exception as e:
        print(f"Error getting data: {e}")
        return pd.DataFrame()

# Function to get financial data
def get_financial_data(ticker):
    # Create a stock object for financial data
    ticker = ticker.strip().upper()
    stock_finance = Vnstock().stock(symbol=ticker, source='VCI')
    nquarter = 13
    # Create a dictionary to store all dataframes
    company_data = {
        'Balance Sheet Yearly': safe_get_data(stock_finance.finance.balance_sheet, period='year', lang='en'),
        'Balance Sheet Quarterly': safe_get_data(stock_finance.finance.balance_sheet, period='quarter', lang='en').head(nquarter),
        'Income Statement Yearly': safe_get_data(stock_finance.finance.income_statement, period='year', lang='en'),
        'Income Statement Quarterly': safe_get_data(stock_finance.finance.income_statement, period='quarter', lang='en').head(nquarter),
        'Cash Flow Yearly': safe_get_data(stock_finance.finance.cash_flow, period='year', lang='en'),
        'Cash Flow Quarterly': safe_get_data(stock_finance.finance.cash_flow, period='quarter', lang='en').head(nquarter),
        'Financial Ratios Yearly': safe_get_data(stock_finance.finance.ratio, period='year', lang='en'),
        'Financial Ratios Quarterly': safe_get_data(stock_finance.finance.ratio, period='quarter', lang='en').head(nquarter),
    }
    print(company_data)
    return company_data

def get_financial_statements(ticker):
    stock = Vnstock().stock(symbol=ticker.upper(), source='VCI')
    data = stock.finance.balance_sheet(period='year', lang='en')
    return data

def get_recent_stock_news(ticker):
    # get company name from ticker
    ticker = ticker.strip().upper()
    articles = fetch_news(ticker)
    content = []
    for article in articles:
        content.append({'summary': article['summary'], 'content':[]})
        #content.append({'summary': article['summary'], 'content':fetch_article_content(article['link'])})
    return content

#search for news and scrape 5 recent news
def fetch_news(query):
    base_url = "https://cafef.vn/tim-kiem.chn"
    # Configure the request parameters
    params = {'keywords': query}
    # Make the request
    response = requests.get(base_url, params=params)
    response.raise_for_status()  # Ensure the request was successful
    # Parse the HTML content
    soup = BeautifulSoup(response.text, 'html.parser')
    # Find the container with the news items
    news_container = soup.find('div', class_='list-section list-event')
    news_items = news_container.find_all('div', class_='item')
    # List to hold news data
    articles = []
    # Loop through each news item
    for item in news_items:
        title_element = item.find('h3', class_='titlehidden').find('a')
        title = title_element.text.strip()
        link = 'https://cafef.vn' + title_element['href']
        summary = item.find('p', class_='sapo').text.strip() if item.find('p', class_='sapo') else 'No summary available'
        # Append news info to the list
        articles.append({'link': link, 'summary': summary})
    return articles[:5]

# fetch article content from link
def fetch_article_content(url):
    # Send a GET request to the URL
    response = requests.get(url)
    response.raise_for_status()  # Ensure the request was successful
    # Parse the HTML content
    soup = BeautifulSoup(response.text, 'html.parser')
    # Find the specific container holding the main content
    content_div = soup.find('div', class_='detail-content afcbc-body')
    if not content_div:
        return "Content not found"
    # Extract all paragraph texts within the container
    paragraphs = content_div.find_all('p')
    main_content = "\n".join(p.text.strip() for p in paragraphs)
    return main_content
