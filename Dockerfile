FROM ghcr.io/langgenius/dify:latest

# PORTはRailway側で設定される（環境変数で渡ってくる）
ENV PORT=3000
CMD ["bash", "/app/start.sh"]

# Railwayで自動起動するようCMDを明示
CMD ["bash", "/app/start.sh"]
