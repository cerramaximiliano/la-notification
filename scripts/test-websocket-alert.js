const axios = require('axios');
const io = require('socket.io-client');
require('dotenv').config();

const API_URL = 'http://localhost:3004';
const WS_URL = 'http://localhost:3004';

// Test user credentials
const testUser = {
    email: 'florencianatalia26@gmail.com',
    userId: '671755aba2b0af02da2a8da9'
};

// JWT token - you'll need to replace this with a valid token
const authToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY3MTc1NWFiYTJiMGFmMDJkYTJhOGRhOSIsInJvbGUiOiJBRE1JTl9ST0xFIiwiZW1haWwiOiJmbG9yZW5jaWFuYXRhbGlhMjZAZ21haWwuY29tIiwiaWF0IjoxNzM0OTk2MTE0LCJleHAiOjE3MzU2MDA5MTR9.bU8eG_-CTU61mbO2gUnqeRr5MvJYOIkShMWzGeSKbxg';

async function testWebSocketAlert() {
    console.log('=== Testing WebSocket Alert Delivery ===\n');

    // 1. Connect to WebSocket
    console.log('1. Connecting to WebSocket...');
    const socket = io(WS_URL, {
        auth: {
            token: authToken
        },
        transports: ['websocket', 'polling']
    });

    // Set up event listeners
    socket.on('connect', () => {
        console.log('✓ Connected to WebSocket server');
        console.log('Socket ID:', socket.id);
        
        // Authenticate
        console.log('\n2. Authenticating user...');
        socket.emit('authenticate', testUser.userId);
    });

    socket.on('authenticated', (data) => {
        console.log('✓ Authentication successful:', data);
        console.log('\n3. Waiting for alerts...');
    });

    socket.on('authentication_error', (error) => {
        console.error('✗ Authentication error:', error);
    });

    socket.on('new_alert', (alert) => {
        console.log('\n✓ NEW ALERT RECEIVED!');
        console.log('Alert details:', JSON.stringify(alert, null, 2));
    });

    socket.on('pending_alerts', (alerts) => {
        console.log('\n✓ PENDING ALERTS RECEIVED!');
        console.log(`Number of alerts: ${alerts.length}`);
        alerts.forEach((alert, index) => {
            console.log(`\nAlert ${index + 1}:`, JSON.stringify(alert, null, 2));
        });
    });

    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });

    socket.on('disconnect', (reason) => {
        console.log('Disconnected:', reason);
    });

    // Wait for connection and authentication
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 4. Create an alert via API
    console.log('\n4. Creating alert via API...');
    try {
        const response = await axios.post(`${API_URL}/api/alerts/create`, {
            userIds: [testUser.userId],
            alert: {
                sourceType: 'system',
                avatarType: 'icon',
                avatarIcon: 'MessageText1',
                avatarSize: 40,
                primaryText: 'Test WebSocket Alert',
                primaryVariant: 'info',
                secondaryText: `WebSocket test alert created at ${new Date().toLocaleTimeString()}`,
                actionText: 'Dismiss',
                deliverImmediately: true
            }
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Cookie': `authToken=${authToken}`
            }
        });

        console.log('\n✓ Alert creation response:');
        console.log(JSON.stringify(response.data, null, 2));

    } catch (error) {
        console.error('\n✗ Error creating alert:', error.response?.data || error.message);
    }

    // Keep the connection open for a while to receive alerts
    console.log('\n5. Keeping connection open for 10 seconds...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Disconnect
    socket.disconnect();
    console.log('\n✓ Test completed');
    process.exit(0);
}

// Run the test
testWebSocketAlert().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
});