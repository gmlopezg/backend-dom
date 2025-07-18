// Importar las librerías necesarias
require('dotenv').config(); // Para cargar variables de entorno desde .env
const express = require('express');
const cors = require('cors');

// Importar la configuración de la base de datos
const pool = require('./config/db'); 

// Importar las rutas
const usuarioRoutes = require('./routes/usuarioRoutes');
const denunciaRoutes = require('./routes/denunciaRoutes');
const contribuyenteRoutes = require('./routes/contribuyenteRoutes');
const adjuntoRoutes = require('./routes/adjuntoRoutes');
const denuncianteAdminRoutes = require('./routes/denuncianteAdminRoutes'); 
const publicDenunciaRoutes = require('./routes/publicDenunciaRoutes');

const app = express();
const port = process.env.PORT || 3001; 

app.use(cors({
  origin: 'http://localhost:5173', // <-- Permite solo el frontend React
  methods: ['GET', 'POST', 'PUT', 'DELETE'], // <-- Métodos permitidos
  allowedHeaders: ['Content-Type', 'Authorization'], // <-- Headers permitidos
}));

app.use(express.json());

// Verificar que JWT_SECRET esté definida
if (!process.env.JWT_SECRET) {
    console.error('ERROR: La variable de entorno JWT_SECRET no está definida. La aplicación no funcionará correctamente sin ella.');
    process.exit(1);
}

// Rutas de la API
// Prefijos para las rutas: /api/usuarios y /api/denuncias
app.use('/api/usuarios', usuarioRoutes);
app.use('/api/denuncias', denunciaRoutes);
app.use('/api/contribuyentes', contribuyenteRoutes);
app.use('/api/adjuntos', adjuntoRoutes);
app.use('/api/admin/denunciantes', denuncianteAdminRoutes); 
app.use('/api/public/denuncias', publicDenunciaRoutes);

// Ruta de prueba simple
app.get('/', (req, res) => {
    res.send('API de Plataforma de Denuncias DOM en funcionamiento.');
});

// Iniciar el servidor
app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
});