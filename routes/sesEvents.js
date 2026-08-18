const express = require("express");
const router = express.Router();
const sesEventsController = require("../controllers/sesEventsController");

// SNS publica con Content-Type text/plain: hay que aceptar el body como texto
// además de JSON, si no llega vacío y la suscripción nunca se confirma.
router.post(
	"/",
	express.text({ type: ["text/plain", "application/json", "text/*"], limit: "1mb" }),
	sesEventsController.handleSnsNotification
);

module.exports = router;
