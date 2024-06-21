# Vigie IA 
## Run
### Backend

```bash
cd docker
sudo docker compose -f docker-compose.middleware.yaml up -d
```

```bash
cd api
conda activate dify
flask run --host 0.0.0.0 --port=5001 --debug
```

```bash
cd api
conda activate dify
celery -A app.celery worker -P gevent -c 1 -Q dataset,generation,mail --loglevel INFO
```

### Frontend

```bash
conda activate dify 
cd web
npm run start
```

Open [http://localhost:3000](http://localhost:3000) 

## Update
### Backend

```bash
conda create --name dify python=3.10
pip install --upgrade -r requirements.txt
flask db upgrade
```
### Frontend

```bash
npm install
npm run build
```

## Documentation

Visit <https://docs.dify.ai/getting-started/readme> to view the full documentation.