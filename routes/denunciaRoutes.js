const express = require('express');
const router = express.Router();
const denunciaController = require('../controllers/denunciaController');
const auth = require('../middleware/auth'); // Importa el middleware de autenticación
const upload = require('../config/multerConfig');

// Rutas de Denuncias

// Obtener todas las denuncias (solo autenticados, cualquier rol)
router.get('/', auth(), denunciaController.getDenuncias);

// Obtener una denuncia por ID (solo autenticados, cualquier rol)
router.get('/:id', auth(), denunciaController.getDenunciaById);

// Ruta para Consulta de Estado de Denuncia (PÚBLICA)
// NOTA: Esta ruta NO tiene el middleware 'auth()'. Es accesible públicamente.
router.get('/status/:id', denunciaController.getDenunciaStatusByPublicId); 

// Crear una nueva denuncia (administrador o inspector)
router.post('/', auth(['administrador', 'inspector']), denunciaController.createDenuncia);

// Actualizar una denuncia por ID (administrador o inspector)
router.put('/:id', auth(['administrador', 'inspector']), denunciaController.updateDenuncia);

// Eliminar una denuncia por ID (solo administrador o director_dom)
router.delete('/:id', auth(['administrador', 'director_de_obras']), denunciaController.deleteDenuncia);

// Asignar una denuncia a un inspector (Solo Director)
router.post('/:id/assign', auth(['director_de_obras']), denunciaController.assignDenuncia);

// Actualizar el estado de una denuncia (Director de Obras e Inspector)
router.put('/:id/state', auth(['director_de_obras', 'inspector']), denunciaController.updateDenunciaState);

// Eliminar un adjunto de una denuncia (Director de Obras e Inspector)
router.delete('/:id/adjuntos/:id_adjunto', auth(['director_de_obras', 'inspector']), denunciaController.deleteAdjunto);

// Obtener el historial completo de estados y asignaciones de una denuncia
router.get('/:id/history', auth(['director_de_obras', 'inspector']), denunciaController.getDenunciaHistory);

// Obtener un reporte de conteo de denuncias por estado y tipo
router.get('/reports/summary', auth(['administrador', 'director_de_obras']), denunciaController.getDenunciaReport);

// Ruta para agregar un avance (comentario) y/o adjuntos a una denuncia
// Permite a inspectores y directores documentar el progreso
router.post('/:id/advances', auth(['inspector', 'director_de_obras']), upload.array('files'), denunciaController.addDenunciaAdvanceAndAttachments);

// Ruta para obtener el historial de avances de una denuncia
router.get('/:id/advances', auth(['inspector', 'director_de_obras', 'administrador']), denunciaController.getDenunciaAdvances);

module.exports = router;