// routes/publicDenuncia.routes.js
const express = require('express');
const router = express.Router();
const publicDenunciaController = require('../controllers/publicDenunciaController');
const denunciaController = require('../controllers/denunciaController');
// No se requiere middleware de autenticación para esta ruta si se permite el registro anónimo o por contribuyentes sin token DOM.

// Ruta para que un usuario externo (denunciante) cree una nueva denuncia.
// ¡Esta ruta NO DEBE tener el middleware 'auth()' para permitir denuncias anónimas!
router.post('/create', publicDenunciaController.createPublicDenuncia);
router.get('/status/:id', denunciaController.getDenunciaStatusByPublicId);


module.exports = router;