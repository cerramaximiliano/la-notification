const mongoose = require('mongoose');
const { Alert, User } = require('../models');
const logger = require('../config/logger');
require('dotenv').config();

async function testAlertWithSource() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.URLDB);

        logger.info('Connected to database');

        // Find a user - try to list all users first
        const userCount = await User.countDocuments();
        logger.info(`Total users in collection: ${userCount}`);
        
        // Try to find any user
        const anyUser = await User.findOne();
        if (anyUser) {
            logger.info(`Found a user: ${anyUser.email}`);
        }
        
        let user = await User.findOne({ email: "florencianatalia26@gmail.com" });
        if (!user) {
            logger.error('Specific user not found, using first available user');
            // Use any user for testing
            user = await User.findOne();
            if (!user) {
                logger.error('No users found in database');
                return;
            }
        }

        logger.info(`Found user: ${user.email}`);

        // Create alert with source tracking
        const alert = await Alert.create({
            userId: user._id,
            sourceType: 'event',
            sourceId: '676f3c4a8e8097e6fb4ac4b5', // The event ID from the original request
            avatarType: 'icon',
            avatarIcon: 'CalendarRemove',
            avatarSize: 40,
            primaryText: 'Evento Próximo',
            primaryVariant: 'warning',
            secondaryText: 'Reunión de planificación - 30/06/2025',
            actionText: 'Ver evento',
            delivered: false,
            read: false,
            deliveryAttempts: 0
        });

        console.log('\nAlert created with source tracking:');
        console.log({
            alertId: alert._id.toString(),
            sourceType: alert.sourceType,
            sourceId: alert.sourceId,
            userId: alert.userId.toString()
        });

        // Verify the alert was saved correctly
        const savedAlert = await Alert.findById(alert._id).lean();
        console.log('\nSaved alert details:');
        console.log(JSON.stringify(savedAlert, null, 2));

    } catch (error) {
        logger.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

testAlertWithSource();