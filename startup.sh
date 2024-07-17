# https://docs.dify.ai/getting-started/install-self-hosted/local-source-code
cd api
poetry shell
flask run --host 0.0.0.0 --port=5001 &
cd ..
cd web
npm run start