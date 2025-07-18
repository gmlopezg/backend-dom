// --- routes/userRoutes.js ---
const express = require('express');
const router = express.Router();
const usuarioController = require('../controllers/usuarioController');
const auth = require('../middleware/auth'); // Importa el middleware de autenticación
const jwt = require('jsonwebtoken'); // Para el login
const bcrypt = require('bcryptjs'); // Para el login
const pool = require('../config/db'); // Para el login

// La clave secreta para JWT viene del .env
const JWT_SECRET = process.env.JWT_SECRET;

// --- Rutas de Autenticación y Gestión de Usuarios DOM ---

// Ruta para iniciar sesión (NO protegida, ya que es la que da el token)
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email y contraseña son obligatorios.' });
    }

    try {
        // Asegúrate de seleccionar nombre_usuario aquí también si tu loginController no lo hace
        const userResult = await pool.query('SELECT id_usuario, nombre_usuario, email, password_hash, rol FROM usuarios WHERE email = $1', [email]);
        const user = userResult.rows[0];

        if (!user) {
            return res.status(401).json({ message: 'Credenciales inválidas (email no encontrado).' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({ message: 'Credenciales inválidas (contraseña incorrecta).' });
        }

        const payload = {
            id: user.id_usuario,
            email: user.email,
            rol: user.rol
        };

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });

        res.status(200).json({
            message: 'Inicio de sesión exitoso.',
            token: token,
            user: {
                id: user.id_usuario,
                email: user.email,
                rol: user.rol,
                nombre_usuario: user.nombre_usuario // Asegura que el nombre se envíe en la respuesta
            }
        });

    } catch (error) {
        console.error('Error durante el inicio de sesión:', error);
        res.status(500).json({ message: 'Error interno del servidor durante el inicio de sesión.' });
    }
});

// --- Rutas Protegidas para la Gestión de Usuarios DOM ---

// Ruta para obtener todos los usuarios (para administradores y director)
router.get('/', auth(['administrador', 'director_de_obras']), usuarioController.getUsuarios);

// Ruta para registrar un nuevo usuario (para administradores y director)
router.post('/register', auth(['administrador', 'director_de_obras']), usuarioController.registerUsuario);

// CORRECCIÓN CLAVE AQUÍ: Obtener un usuario DOM por ID (para administradores Y director)
router.get('/:id', auth(['administrador', 'director_de_obras']), usuarioController.getUsuarioById); // ¡CAMBIO AQUÍ!

// Actualizar un usuario DOM por ID (para administradores y director)
router.put('/:id', auth(['administrador', 'director_de_obras']), usuarioController.updateUsuario);

// Eliminar un usuario DOM por ID (para administradores y director)
router.delete('/:id', auth(['administrador', 'director_de_obras']), usuarioController.deleteUsuario); // Asegúrate de que esta ruta también esté protegida correctamente

module.exports = router;