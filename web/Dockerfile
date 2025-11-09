# Updated Dockerfile

# Base image
FROM jogaina/jogaina-base:latest

# Set environment variables
ENV JOGAINA_URL=https://jogaina-url.com

# Copying application code
COPY . /app

# Update URLs
RUN sed -i 's|dify-url.com|jogaina-url.com|g' /app/config/config.yml

# Expose application port
EXPOSE 8080

# Start application
CMD ["npm", "start"]