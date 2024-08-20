from datetime import datetime, timedelta
import pandas as pd
from datetime import date

import re
import requests
from vnstock3 import Vnstock
from bs4 import BeautifulSoup

class StockDataCache:
  def __init__(self, expiration_time=timedelta(minutes=5)):
      self.cache = {}
      self.expiration_time = expiration_time

  def get(self, ticker):
      if ticker in self.cache:
          data, timestamp = self.cache[ticker]
          if datetime.now() - timestamp < self.expiration_time:
              return data
          else:
              del self.cache[ticker]  # Remove expired data
      return None

  def set(self, ticker, data):
      self.cache[ticker] = (data, datetime.now())

  def clear_expired(self):
      now = datetime.now()
      expired_keys = [k for k, (_, timestamp) in self.cache.items() 
                      if now - timestamp >= self.expiration_time]
      for key in expired_keys:
          del self.cache[key]

  def clear_all(self):
      self.cache.clear()


stock_cache = StockDataCache()

# get stock history of the company
def get_stock_price(ticker, history=200):
    with open("company.json", 'a') as file:
        file.write(f'\nget stock price for ticker: {ticker}')
    today = date.today()
    start_date = today - timedelta(days=history)
    stock = Vnstock().stock(symbol=ticker.strip(), source='TCBS')
    data = stock.quote.history(start=start_date.strftime('%Y-%m-%d'),end=today.strftime('%Y-%m-%d'))
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
