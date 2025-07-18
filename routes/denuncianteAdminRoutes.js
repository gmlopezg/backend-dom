const express = require('express');
const router = express.Router();
const denuncianteAdminController = require('../controllers/denuncianteAdminController');
const auth = require('../middleware/auth'); // Middleware de autenticación para usuarios DOM

// Rutas para la gestión de denunciantes por parte de ADMINISTRADORES DOM
// Solo los administradores deberían tener acceso a estas funciones.

// Obtener todos los denunciantes
router.get('/', auth(['administrador']), denuncianteAdminController.getAllDenunciantes);

// Obtener un denunciante por ID
router.get('/:id', auth(['administrador']), denuncianteAdminController.getDenuncianteById);

// Actualizar un denunciante por ID
router.put('/:id', auth(['administrador']), denuncianteAdminController.updateDenunciante); 

module.exports = router;