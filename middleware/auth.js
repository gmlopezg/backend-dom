const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

// Este middleware es una función que retorna otra función
// La función interna (req, res, next) es el middleware de Express
// La función externa (roles) permite pasar qué roles están permitidos
module.exports = function(roles = []) { // roles es un array de strings (ej. ['administrador', 'inspector'])
    // Si no se especifican roles, se convierte en un array vacío para facilitar la lógica
    if (typeof roles === 'string') {
        roles = [roles];
    }

    return (req, res, next) => {
        // --- Parte de autenticación ---
        const token = req.header('Authorization');

        console.log('--- Depurando auth.js Middleware (PARA USUARIOS DOM) ---');
        console.log('URL de la petición:', req.originalUrl); // Qué URL se está llamando
        console.log('Header de Autorización recibido:', token);

        if (!token) {
            return res.status(401).json({ message: 'Acceso denegado. No se proporcionó token.' });
        }

        const tokenParts = token.split(' ');
        if (tokenParts.length !== 2 || tokenParts[0] !== 'Bearer') {
            return res.status(401).json({ message: 'Formato de token inválido. Use "Bearer [token]".' });
        }
        const actualToken = tokenParts[1];

        try {
            const decoded = jwt.verify(actualToken, JWT_SECRET);
            req.user = decoded; // Adjuntamos la información del usuario a la petición

            console.log('Token decodificado exitosamente. ID de Usuario:', req.user.id, 'Rol:', req.user.rol);
            console.log('Roles requeridos para esta ruta:', roles);

            // --- Parte de autorización basada en roles ---
            if (roles.length && !roles.includes(req.user.rol)) {
                console.log('El rol del usuario (', req.user.rol, ') NO COINCIDE con los roles requeridos (', roles, '). Devolviendo 403.');
                // Si se especificaron roles requeridos y el rol del usuario no está en la lista
                return res.status(403).json({ message: 'Acceso denegado. No tiene los permisos necesarios para esta acción.' }); // 403 Forbidden
            }

            console.log('Usuario autorizado. Continuando al siguiente middleware/controlador.');
            // Si el token es válido y el rol es permitido, continuamos
            next();
        } catch (error) {
            console.log('Fallo la verificación del token. Devolviendo 401. Error:', error.message);
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json({ message: 'Token expirado. Por favor, inicie sesión nuevamente.' });
            }
            return res.status(401).json({ message: 'Token no válido.' });
        }
    };
};