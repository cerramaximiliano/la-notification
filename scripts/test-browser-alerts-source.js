const mongoose = require('mongoose');
const { Event, Task, Movement, User, Alert } = require('../models');
const logger = require('../config/logger');
const moment = require('moment-timezone');
const { sendCalendarBrowserAlerts, sendTaskBrowserAlerts, sendMovementBrowserAlerts } = require('../services/browser');
require('dotenv').config();

async function testBrowserAlertsWithSource() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.URLDB);
        logger.info('Connected to database');

        // Find a test user
        let user = await User.findOne({ email: "florencianatalia26@gmail.com" });
        if (!user) {
            user = await User.findOne();
            if (!user) {
                logger.error('No users found in database');
                return;
            }
        }
        
        logger.info(`Testing with user: ${user.email}`);

        // Test calendar (event) alerts
        logger.info('\n=== Testing Calendar/Event Alerts ===');
        const eventResult = await sendCalendarBrowserAlerts({
            userId: user._id.toString(),
            models: { Event, Task, Movement, User, Alert },
            utilities: { logger, mongoose, moment }
        });
        console.log('Event alert result:', eventResult);

        // Check if alerts were created with source tracking
        const eventAlerts = await Alert.find({
            userId: user._id,
            sourceType: 'event'
        }).sort({ createdAt: -1 }).limit(5);
        
        console.log(`\nFound ${eventAlerts.length} event alerts with source tracking:`);
        eventAlerts.forEach(alert => {
            console.log({
                id: alert._id.toString(),
                sourceType: alert.sourceType,
                sourceId: alert.sourceId,
                secondaryText: alert.secondaryText,
                created: alert.createdAt
            });
        });

        // Test task alerts
        logger.info('\n=== Testing Task Alerts ===');
        const taskResult = await sendTaskBrowserAlerts({
            userId: user._id.toString(),
            models: { Event, Task, Movement, User, Alert },
            utilities: { logger, mongoose, moment }
        });
        console.log('Task alert result:', taskResult);

        // Check task alerts
        const taskAlerts = await Alert.find({
            userId: user._id,
            sourceType: 'task'
        }).sort({ createdAt: -1 }).limit(5);
        
        console.log(`\nFound ${taskAlerts.length} task alerts with source tracking:`);
        taskAlerts.forEach(alert => {
            console.log({
                id: alert._id.toString(),
                sourceType: alert.sourceType,
                sourceId: alert.sourceId,
                secondaryText: alert.secondaryText,
                created: alert.createdAt
            });
        });

        // Test movement alerts
        logger.info('\n=== Testing Movement Alerts ===');
        const movementResult = await sendMovementBrowserAlerts({
            userId: user._id.toString(),
            models: { Event, Task, Movement, User, Alert },
            utilities: { logger, mongoose, moment }
        });
        console.log('Movement alert result:', movementResult);

        // Check movement alerts
        const movementAlerts = await Alert.find({
            userId: user._id,
            sourceType: 'movement'
        }).sort({ createdAt: -1 }).limit(5);
        
        console.log(`\nFound ${movementAlerts.length} movement alerts with source tracking:`);
        movementAlerts.forEach(alert => {
            console.log({
                id: alert._id.toString(),
                sourceType: alert.sourceType,
                sourceId: alert.sourceId,
                secondaryText: alert.secondaryText,
                created: alert.createdAt
            });
        });

        // Summary of all alerts with source tracking
        const allSourceTypes = await Alert.aggregate([
            { $match: { userId: user._id } },
            { $group: { _id: '$sourceType', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);
        
        console.log('\n=== Alert Summary by Source Type ===');
        console.log(allSourceTypes);

    } catch (error) {
        logger.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

testBrowserAlertsWithSource();