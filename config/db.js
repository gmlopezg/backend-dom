const { Pool } = require('pg');
require('dotenv').config(); // Cargar las variables de entorno aquí también si es un módulo independiente

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: {
        rejectUnauthorized: false // Importante: Permite la conexión a certificados autofirmados o no reconocidos por tu sistema local.
    }
});

// Test the database connection
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error al conectar a la base de datos:', err.stack);
    }
    console.log('Conexión exitosa a PostgreSQL.');
    release(); // Release the client back to the pool
});

module.exports = pool;