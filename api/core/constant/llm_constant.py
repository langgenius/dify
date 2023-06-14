from _decimal import Decimal

models = {
    'gpt-4': 'openai',  # 8,192 tokens
    'gpt-4-32k': 'openai',  # 32,768 tokens
    'gpt-3.5-turbo': 'openai',  # 4,096 tokens
    'gpt-3.5-turbo-16k': 'openai',  # 16384 tokens
    'text-davinci-003': 'openai',  # 4,097 tokens
    'text-davinci-002': 'openai',  # 4,097 tokens
    'text-curie-001': 'openai',  # 2,049 tokens
    'text-babbage-001': 'openai',  # 2,049 tokens
    'text-ada-001': 'openai',  # 2,049 tokens
    'text-embedding-ada-002': 'openai'  # 8191 tokens, 1536 dimensions
}

max_context_token_length = {
    'gpt-4': 8192,
    'gpt-4-32k': 32768,
    'gpt-3.5-turbo': 4096,
    'gpt-3.5-turbo-16k': 16384,
    'text-davinci-003': 4097,
    'text-davinci-002': 4097,
    'text-curie-001': 2049,
    'text-babbage-001': 2049,
    'text-ada-001': 2049,
    'text-embedding-ada-002': 8191
}

models_by_mode = {
    'chat': [
        'gpt-4',  # 8,192 tokens
        'gpt-4-32k',  # 32,768 tokens
        'gpt-3.5-turbo',  # 4,096 tokens
        'gpt-3.5-turbo-16k',  # 16,384 tokens
    ],
    'completion': [
        'gpt-4',  # 8,192 tokens
        'gpt-4-32k',  # 32,768 tokens
        'gpt-3.5-turbo',  # 4,096 tokens
        'gpt-3.5-turbo-16k',  # 16,384 tokens
        'text-davinci-003',  # 4,097 tokens
        'text-davinci-002'  # 4,097 tokens
        'text-curie-001',  # 2,049 tokens
        'text-babbage-001',  # 2,049 tokens
        'text-ada-001'  # 2,049 tokens
    ],
    'embedding': [
        'text-embedding-ada-002'  # 8191 tokens, 1536 dimensions
    ]
}

model_currency = 'USD'

model_prices = {
    'gpt-4': {
        'prompt': Decimal('0.03'),
        'completion': Decimal('0.06'),
    },
    'gpt-4-32k': {
        'prompt': Decimal('0.06'),
        'completion': Decimal('0.12')
    },
    'gpt-3.5-turbo': {
        'prompt': Decimal('0.0015'),
        'completion': Decimal('0.002')
    },
    'gpt-3.5-turbo-16k': {
        'prompt': Decimal('0.003'),
        'completion': Decimal('0.004')
    },
    'text-davinci-003': {
        'prompt': Decimal('0.02'),
        'completion': Decimal('0.02')
    },
    'text-curie-001': {
        'prompt': Decimal('0.002'),
        'completion': Decimal('0.002')
    },
    'text-babbage-001': {
        'prompt': Decimal('0.0005'),
        'completion': Decimal('0.0005')
    },
    'text-ada-001': {
        'prompt': Decimal('0.0004'),
        'completion': Decimal('0.0004')
    },
    'text-embedding-ada-002': {
        'usage': Decimal('0.0001'),
    }
}

agent_model_name = 'text-davinci-003'
