const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

module.exports = function(req, res, next) {
    // El token se espera en el header Authorization como "Bearer [token]"
    const token = req.header('Authorization');

    // 1. Verificar si hay un token
    if (!token) {
        return res.status(401).json({ message: 'Acceso denegado. No se proporcionó token de contribuyente.' });
    }

    // 2. Extraer el token (quitar "Bearer ")
    const tokenParts = token.split(' ');
    if (tokenParts.length !== 2 || tokenParts[0] !== 'Bearer') {
        return res.status(401).json({ message: 'Formato de token inválido. Use "Bearer [token]".' });
    }
    const actualToken = tokenParts[1];

    try {
        // 3. Verificar y decodificar el token
        const decoded = jwt.verify(actualToken, JWT_SECRET);

        // 4. Adjuntar la información del contribuyente a la petición
        // Esto permitirá acceder a req.contribuyente.id, req.contribuyente.email en las rutas protegidas
        req.contribuyente = decoded;

        // 5. Continuar con la siguiente función del middleware/ruta
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token de contribuyente expirado. Por favor, inicie sesión nuevamente.' });
        }
        return res.status(401).json({ message: 'Token de contribuyente no válido.' });
    }
};