const mongoose = require("mongoose");

const AlertSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        groupId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'UserGroup',
            required: false,
            index: true
        },
        folderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Folder',
            required: true,
            index: true
        },
        avatarType: {
            type: String,
            required: false,
        },
        avatarIcon: {
            type: String,
            enum: ["Gift", "MessageText1", "Setting2"],
            required: false,
        },
        avatarSize: {
            type: Number,
            required: false,
        },
        avatarInitial: {
            type: String,
            required: false,
        },
        primaryText: {
            type: String,
            required: true,
        },
        primaryVariant: {
            type: String,
            required: true,
        },
        secondaryText: {
            type: String,
            required: true,
        },
        actionText: {
            type: String,
            required: true,
        },
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
    }
);

const Alert = mongoose.model("Alert", AlertSchema);
module.exports = Alert;
