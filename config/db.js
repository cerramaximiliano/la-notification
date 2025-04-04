// config/db.js
const mongoose = require("mongoose");
const logger = require("./logger");

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.URLDB);
        logger.info("MongoDB connected");
    } catch (error) {
        logger.error("Error connecting to MongoDB:", error.message);
        process.exit(1);
    }
};

module.exports = connectDB;
