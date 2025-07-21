const mongoose = require('mongoose');
const { Alert, User } = require('../models');
const logger = require('../config/logger');
require('dotenv').config();

// Import the alert controller's function directly
const { createCustomAlert } = require('../controllers/alertController');

async function testAlertDelivery() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.URLDB);
        logger.info('Connected to database');

        // Find test user
        const user = await User.findOne().select('_id email');
        if (!user) {
            logger.error('No users found');
            return;
        }

        logger.info(`Testing with user: ${user.email} (${user._id})`);

        // Create a mock request/response for the controller
        const mockReq = {
            body: {
                userIds: [user._id.toString()],
                alert: {
                    sourceType: 'system',
                    avatarType: 'icon',
                    avatarIcon: 'MessageText1',
                    avatarSize: 40,
                    primaryText: 'Direct Test Alert',
                    primaryVariant: 'warning',
                    secondaryText: `Direct test at ${new Date().toLocaleTimeString()}`,
                    actionText: 'View Details',
                    deliverImmediately: true
                }
            },
            userId: 'system' // Mock system user
        };

        const mockRes = {
            status: (code) => ({
                json: (data) => {
                    console.log(`\nResponse Status: ${code}`);
                    console.log('Response Data:', JSON.stringify(data, null, 2));
                }
            }),
            json: (data) => {
                console.log('\nResponse Data:', JSON.stringify(data, null, 2));
            }
        };

        console.log('\nCalling createCustomAlert directly...');
        await createCustomAlert(mockReq, mockRes);

        // Check if alert was created and delivered
        const latestAlert = await Alert.findOne({ userId: user._id })
            .sort({ createdAt: -1 })
            .lean();

        if (latestAlert) {
            console.log('\nLatest alert details:');
            console.log({
                id: latestAlert._id,
                delivered: latestAlert.delivered,
                deliveryAttempts: latestAlert.deliveryAttempts,
                secondaryText: latestAlert.secondaryText,
                sourceType: latestAlert.sourceType,
                created: latestAlert.createdAt
            });
        }

    } catch (error) {
        logger.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

testAlertDelivery();