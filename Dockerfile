FROM ghcr.io/langgenius/dify:latest

# Railway用ポート設定
ENV PORT=3000

# サービス起動
CMD ["bash", "/app/start.sh"]
