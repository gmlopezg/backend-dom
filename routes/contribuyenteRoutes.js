// --- routes/contribuyenteRoutes.js ---
const express = require('express');
const router = express.Router();
const contribuyenteController = require('../controllers/contribuyenteController'); // Asegúrate de la ruta correcta a tu controlador
const auth = require('../middleware/auth'); // Middleware para usuarios DOM (roles)
const authContribuyente = require('../middleware/authContribuyente'); // Middleware para contribuyentes

// --- Ruta para Registrar un Nuevo Contribuyente ---
router.post('/register', contribuyenteController.registerContribuyente);

// --- Ruta para Iniciar Sesión de Contribuyentes ---
router.post('/login', contribuyenteController.loginContribuyente);

// --- Ruta para obtener denuncias de un contribuyente específico ---
router.get('/:id/denuncias', authContribuyente, contribuyenteController.getDenunciasByContribuyenteId); // ¡NUEVA RUTA!

// --- Rutas de ejemplo protegidas para Contribuyentes ---
router.get('/me', authContribuyente, (req, res) => {
    res.status(200).json({
        message: 'Acceso permitido a perfil de contribuyente.',
        contribuyente: req.contribuyente
    });
});

router.put('/me', authContribuyente, (req, res) => {
    req.params.id = req.contribuyente.id; // Asumiendo que authContribuyente adjunta req.contribuyente.id
    contribuyenteController.updateContribuyente(req, res);
});

router.delete('/me', authContribuyente, (req, res) => {
    req.params.id = req.contribuyente.id; // Asumiendo que authContribuyente adjunta req.contribuyente.id
    contribuyenteController.deleteContribuyente(req, res);
});

// --- Rutas Protegidas para Administrador DOM ---
router.get('/', auth(['administrador']), contribuyenteController.getContribuyentes);
router.get('/:id', auth(['administrador']), contribuyenteController.getContribuyenteById);
router.put('/:id', auth(['administrador']), contribuyenteController.updateContribuyente);
router.delete('/:id', auth(['administrador']), contribuyenteController.deleteContribuyente);

module.exports = router;