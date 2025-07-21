const mongoose = require('mongoose');
const { Alert, User } = require('../models');
const logger = require('../config/logger');
const websocketService = require('../services/websocket');
require('dotenv').config();

async function testSimpleWebSocket() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.URLDB);
        logger.info('Connected to database');

        // Find a test user
        const user = await User.findOne().select('_id email');
        if (!user) {
            logger.error('No users found');
            return;
        }

        logger.info(`Testing with user: ${user.email} (${user._id})`);

        // Check if user is connected
        const isConnected = websocketService.isUserConnected(user._id.toString());
        logger.info(`User connected via WebSocket: ${isConnected}`);

        // Create a test alert
        const alert = await Alert.create({
            userId: user._id,
            sourceType: 'system',
            avatarType: 'icon',
            avatarIcon: 'MessageText1',
            avatarSize: 40,
            primaryText: 'Test Alert',
            primaryVariant: 'info',
            secondaryText: `Test alert created at ${new Date().toLocaleTimeString()}`,
            actionText: 'Dismiss',
            delivered: false,
            read: false,
            deliveryAttempts: 0
        });

        logger.info(`Alert created: ${alert._id}`);

        // Try to send via WebSocket
        if (isConnected) {
            logger.info('Attempting to send alert via WebSocket...');
            const sent = await websocketService.sendPushAlert(user._id.toString(), alert);
            logger.info(`Alert sent: ${sent}`);
        } else {
            logger.info('User not connected, alert will be pending');
            
            // Check if global.io is set
            logger.info(`global.io is set: ${!!global.io}`);
            
            // Try to send to all connected sockets (for debugging)
            if (global.io) {
                logger.info('Broadcasting test message to all connected clients...');
                global.io.emit('test_message', { message: 'Hello from server!' });
            }
        }

        // Check alert status
        const updatedAlert = await Alert.findById(alert._id);
        logger.info(`Alert delivered status: ${updatedAlert.delivered}`);

    } catch (error) {
        logger.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

testSimpleWebSocket();