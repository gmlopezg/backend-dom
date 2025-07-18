const express = require('express');
const router = express.Router();
const upload = require('../config/multerConfig'); // Importa la configuración de Multer
const adjuntoController = require('../controllers/adjuntoController.js');
const auth = require('../middleware/auth'); // Para usuarios DOM
// const authContribuyente = require('../middleware/authContribuyente'); // Para contribuyentes

// Middleware para determinar la identidad del usuario (DOM o Contribuyente)
// Este middleware intentará autenticar con authContribuyente, y si falla, intentará con auth DOM.
// Luego, adjuntará la info del usuario (req.user o req.contribuyente) si alguno pasa.
// const authenticateBoth = (req, res, next) => {
//     authContribuyente(req, res, (err) => {
//         if (err) {
//             // Si authContribuyente falla o no encuentra token, intentamos con auth DOM
//             auth(['administrador', 'inspector'])(req, res, next); // Solo admin e inspector pueden subir adjuntos?
//                                                                  // Ajusta los roles según quién puede subir adjuntos.
//         } else {
//             // Si authContribuyente fue exitoso, ya estamos autenticados como contribuyente.
//             next();
//         }
//     });
// };

// --- Ruta para Subir un Adjunto ---
// 'file' es el nombre del campo en el formulario que contendrá el archivo
router.post('/upload', upload.single('file'), adjuntoController.uploadAdjunto); // Sin autenticación directa 

// --- Ruta para Obtener/Descargar un Adjunto (ej. http://localhost:3001/api/adjuntos/download/1) ---
// Podrías requerir autenticación para descargar archivos sensibles, o dejarlos públicos
router.get('/download/:id', adjuntoController.getAdjunto);

// --- Ruta para Eliminar un Adjunto (requiere autenticación y posiblemente autorización por rol) ---
// Solo el administrador o el propio usuario que lo subió deberían poder eliminarlo
router.delete('/:id', auth(['administrador']), adjuntoController.deleteAdjunto); // Por ahora, solo administrador puede eliminar

module.exports = router;