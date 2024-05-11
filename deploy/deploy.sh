echo "welcome to dify! choose from an option below:"
echo "a) install"
echo "b) upgrade"
echo "c) start"
echo "d) stop"
echo "e) restart"

read -p "Enter your choice: " choice

case $choice in
  a | i | install)
    echo "Starting installation..."
    # Download docker-compose.yaml
    if curl -o docker-compose.yaml https://github.com/langgenius/dify/blob/main/docker/docker-compose.yaml; then
      echo "docker-compose.yaml downloaded successfully."
    else
      echo "Failed to download docker-compose.yaml."
      exit 1
    fi

    # Download nginx configs
    if mkdir -p nginx && cd nginx && curl -L https://github.com/langgenius/dify/tree/main/docker/nginx | tar -xz --strip=1; then
      echo "Nginx directory downloaded successfully."
      cd ..
    else
      echo "Failed to download nginx directory."
      exit 1
    fi

    # Download .env example and rename it
    if curl -o .env https://github.com/langgenius/dify/tree/main/docker/env/.env.example; then
      echo ".env configuration file downloaded and renamed successfully."
    else
      echo "Failed to download .env configuration file."
      exit 1
    fi

    echo "Installation complete."
    ;;
  b | u | upgrade)
    echo "Upgrade option selected."
    echo "Stopping all services..."
    docker-compose down
    echo "Downloading the latest docker-compose.yaml..."
    if curl -o docker-compose.yaml https://github.com/langgenius/dify/blob/main/docker/docker-compose.yaml; then
      echo "docker-compose.yaml updated successfully."
      echo "Restarting services with the new configuration..."
      docker-compose up -d
      echo "Dify has been restarted successfully."
    else
      echo "Failed to update docker-compose.yaml."
      exit 1
    fi
    ;;
  c | s | start)
    echo "Start option selected."
    echo "Starting all services..."
    docker-compose up -d
    echo "Dify has been started successfully."
    ;;
  d | stop)
    echo "Stop option selected."
    echo "Stopping all services..."
    docker-compose down
    echo "Dify has been stopped successfully."
    ;;
  e | r | restart)
    echo "Restart option selected."
    echo "Stopping all services..."
    docker-compose down
    echo "Starting all services..."
    docker-compose up -d
    echo "Dify has been restarted successfully."
    ;;
  *)
    echo "Invalid option selected."
    ;;
esac
