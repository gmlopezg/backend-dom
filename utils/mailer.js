const nodemailer = require('nodemailer');

// Carga las variables de entorno para las credenciales del correo
require('dotenv').config();

// Configura el transportador de correo
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_SERVICE_HOST,
    port: parseInt(process.env.EMAIL_SERVICE_PORT, 10), // Asegurarse de que el puerto sea un número
    secure: process.env.EMAIL_SERVICE_SECURE === 'true', // Asegurarse de que sea un booleano
    auth: {
        user: process.env.EMAIL_AUTH_USER,
        pass: process.env.EMAIL_AUTH_PASS,
    },
    tls: {
        // Para Nodemailer con algunos servidores, a veces necesitas esto para evitar errores de certificado autofirmado
        }
});

// Función para enviar un correo
const sendEmail = async (to, subject, htmlContent) => {
    try {
        const mailOptions = {
            from: process.env.EMAIL_AUTH_USER, // Remitente
            to: to, // Destinatario
            subject: subject, // Asunto
            html: htmlContent, // Contenido HTML del correo
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Correo enviado: %s', info.messageId);
        // console.log('Vista previa URL: %s', nodemailer.getTestMessageUrl(info)); // Solo para pruebas con Ethereal
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Error al enviar el correo:', error);
        return { success: false, error: error.message };
    }
};

module.exports = {
    sendEmail
};