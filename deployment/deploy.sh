#!/bin/bash

# Check if DOMAIN_NAME is set
if [ -z "$DOMAIN_NAME" ]; then
    echo "Error: DOMAIN_NAME environment variable is not set."
    echo "Usage: DOMAIN_NAME=your-domain.com ./deploy.sh"
    exit 1
fi

echo "🚀 Deploying RAV to $DOMAIN_NAME..."

# Create .env file for production if it doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env from defaults..."
    echo "DOMAIN_NAME=$DOMAIN_NAME" > .env
    echo "MINIO_USER=admin" >> .env
    echo "MINIO_PASSWORD=$(openssl rand -hex 16)" >> .env
fi

# Pull latest images (if using CI/CD) or build locally
echo "📦 Building/Pulling images..."
docker compose -f docker-compose.prod.yml build

# Start services
echo "🔥 Starting services..."
docker compose -f docker-compose.prod.yml up -d

echo "✅ Deployment complete!"
echo "Dashboard: https://$DOMAIN_NAME"
echo "API: https://$DOMAIN_NAME/api"
