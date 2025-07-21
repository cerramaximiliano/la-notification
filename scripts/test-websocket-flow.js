const io = require('socket.io-client');
const axios = require('axios');

const WS_URL = 'http://localhost:3004';
const API_URL = 'http://localhost:3004';

// Test configuration
const testUserId = '5f1f10d45b860e5a18acb7a2'; // julieta.bombora@gmail.com
const testToken = 'test-token'; // We'll authenticate with userId directly for testing

async function testWebSocketFlow() {
    console.log('=== Testing WebSocket Alert Flow ===\n');

    return new Promise((resolve, reject) => {
        // 1. Connect to WebSocket
        console.log('1. Connecting to WebSocket server...');
        const socket = io(WS_URL, {
            transports: ['websocket', 'polling'],
            reconnection: true
        });

        let alertReceived = false;

        socket.on('connect', () => {
            console.log('✓ Connected to WebSocket');
            console.log('  Socket ID:', socket.id);
            
            // 2. Authenticate
            console.log('\n2. Authenticating user...');
            socket.emit('authenticate', testUserId);
        });

        socket.on('authenticated', (data) => {
            console.log('✓ Authentication successful:', data);
            
            // 3. Create alert after authentication
            setTimeout(async () => {
                console.log('\n3. Creating alert via direct database call...');
                
                try {
                    // Use a simple HTTP request to create alert
                    const response = await axios.post(`${API_URL}/api/alerts/create`, {
                        userIds: [testUserId],
                        alert: {
                            sourceType: 'system',
                            avatarType: 'icon',
                            avatarIcon: 'MessageText1',
                            avatarSize: 40,
                            primaryText: 'WebSocket Test',
                            primaryVariant: 'info',
                            secondaryText: `Test alert at ${new Date().toLocaleTimeString()}`,
                            actionText: 'Dismiss',
                            deliverImmediately: true
                        }
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            // Skip auth for this test
                            'X-Test-Mode': 'true'
                        },
                        validateStatus: () => true // Accept any status
                    });

                    console.log('\n✓ Alert API Response:');
                    console.log('  Status:', response.status);
                    console.log('  Data:', JSON.stringify(response.data, null, 2));
                    
                } catch (error) {
                    console.error('✗ Error creating alert:', error.message);
                }
            }, 1000);
        });

        socket.on('authentication_error', (error) => {
            console.error('✗ Authentication failed:', error);
            socket.disconnect();
            reject(new Error('Authentication failed'));
        });

        socket.on('new_alert', (alert) => {
            console.log('\n🔔 NEW ALERT RECEIVED!');
            console.log('Alert details:', JSON.stringify(alert, null, 2));
            alertReceived = true;
        });

        socket.on('pending_alerts', (alerts) => {
            console.log('\n📋 PENDING ALERTS RECEIVED!');
            console.log(`Number of alerts: ${alerts.length}`);
            if (alerts.length > 0) {
                console.log('Latest alert:', JSON.stringify(alerts[0], null, 2));
            }
        });

        socket.on('test_message', (data) => {
            console.log('\n📨 TEST MESSAGE:', data);
        });

        socket.on('error', (error) => {
            console.error('❌ Socket error:', error);
        });

        socket.on('disconnect', (reason) => {
            console.log('\n🔌 Disconnected:', reason);
        });

        // Wait for alerts and then cleanup
        setTimeout(() => {
            console.log('\n4. Test completed');
            console.log(`Alert received via WebSocket: ${alertReceived ? 'YES ✓' : 'NO ✗'}`);
            socket.disconnect();
            resolve();
        }, 5000);
    });
}

// Run test
testWebSocketFlow()
    .then(() => {
        console.log('\n✓ Test finished successfully');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n✗ Test failed:', error);
        process.exit(1);
    });