# CampusConnect Deployment Guide

This guide provides instructions for deploying CampusConnect using Docker, Docker Compose, and Google Cloud Run.

---

## 1. Quick Start with Docker

### Build the Docker Image
```bash
docker build -t campusconnect:latest .
```

### Run the Container
```bash
docker run -d \
  --name campusconnect-app \
  -p 3000:3000 \
  -e NODE_ENV=production \
  campusconnect:latest
```

Open your browser and navigate to: `http://localhost:3000`

---

## 2. Running with Docker Compose

To run the container using Docker Compose:

```bash
# Build and start the container in detached mode
docker-compose up -d --build

# View container logs
docker-compose logs -f

# Check health status
docker-compose ps

# Stop the container
docker-compose down
```

---

## 3. Deploying to Google Cloud Run

CampusConnect is configured to run on Google Cloud Run with automatic container scaling and port routing.

### Step 1: Authenticate with Google Cloud
```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

### Step 2: Build and Push Image to Google Artifact Registry
```bash
# Configure Docker authentication
gcloud auth configure-docker REGION-docker.pkg.dev

# Tag and push
docker tag campusconnect:latest REGION-docker.pkg.dev/YOUR_PROJECT_ID/campusconnect-repo/campusconnect:latest
docker push REGION-docker.pkg.dev/YOUR_PROJECT_ID/campusconnect-repo/campusconnect:latest
```

### Step 3: Deploy to Cloud Run
```bash
gcloud run deploy campusconnect \
  --image REGION-docker.pkg.dev/YOUR_PROJECT_ID/campusconnect-repo/campusconnect:latest \
  --platform managed \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --port 3000 \
  --set-env-vars NODE_ENV=production
```

---

## 4. Health Check

CampusConnect includes a built-in healthcheck endpoint:
- `GET /api/health`

Returns:
```json
{
  "status": "healthy",
  "uptime": 124.5,
  "activeUsersCount": 3,
  "firebaseAdminConfigured": true,
  "firestoreDatabaseId": "ai-studio-campusconnectrea-757c0d50-38de-4e24-a364-dc601baa4c07",
  "projectId": "campusconnect-app",
  "timestamp": "2026-09-04T23:00:00.000Z"
}
```

---

## 5. Environment Variables Reference

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Listening port for the Express/Socket.IO server | `3000` |
| `NODE_ENV` | Runtime environment (`production` or `development`) | `production` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Optional path to Google service account key JSON file | None |
