# WebSocket Alert System - La Notification

## Overview

The notification service includes a WebSocket server that allows real-time delivery of alerts to connected users. When alerts are created with `deliverImmediately: true`, they will be pushed to connected users instantly.

## How It Works

1. **WebSocket Server**: Runs on the same port as the notification service (3004)
2. **Authentication**: Users must authenticate with a valid JWT token
3. **Alert Delivery**: When alerts are created, they are automatically pushed to connected users

## Testing WebSocket Alerts

### 1. Generate a Test Token

```bash
node scripts/generate-test-token.js
```

This will output a JWT token for the test user.

### 2. Test Using the Web Client

Start the test client server:
```bash
node scripts/serve-client.js
```

Then open http://localhost:3005 in your browser.

1. Paste the JWT token in the token field
2. Click "Connect"
3. Click "Create Test Alert"
4. You should see the alert appear instantly

### 3. Test Using Command Line

```bash
# Test WebSocket connection and alert delivery
node scripts/test-websocket-flow.js
```

## API Usage

### Creating Alerts with Immediate Delivery

```javascript
POST /api/alerts/create
{
  "userIds": ["userId"],
  "alert": {
    "sourceType": "event",
    "sourceId": "eventId",
    "primaryText": "Event Reminder",
    "secondaryText": "Your event is tomorrow",
    "actionText": "View Event",
    "deliverImmediately": true  // This triggers WebSocket delivery
  }
}
```

## WebSocket Events

### Client to Server
- `authenticate`: Authenticate with userId
- `disconnect`: Disconnect from server

### Server to Client
- `authenticated`: Authentication successful
- `authentication_error`: Authentication failed
- `new_alert`: New alert received
- `pending_alerts`: Array of pending alerts
- `auth_expired`: Token has expired

## Source Tracking

All alerts now include source tracking:
- `sourceType`: 'event', 'task', 'movement', 'system', 'marketing', 'custom'
- `sourceId`: Reference to the original entity (optional)

This allows tracking which entity triggered each alert for better analytics.

## Troubleshooting

1. **"Token requerido" error**: Make sure to provide a valid JWT token
2. **User not connected**: Check WebSocket connection status
3. **Alert not delivered**: Verify `deliverImmediately: true` is set

## Example Integration

```javascript
// Connect to WebSocket
const socket = io('http://localhost:3004', {
  auth: { token: 'your-jwt-token' }
});

// Authenticate
socket.on('connect', () => {
  socket.emit('authenticate', userId);
});

// Listen for alerts
socket.on('new_alert', (alert) => {
  console.log('New alert:', alert);
});
```