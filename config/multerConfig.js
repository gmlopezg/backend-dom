const multer = require('multer');
const path = require('path');
const fs = require('fs'); // Necesario para verificar y crear directorios

// Define el directorio base de carga (por ejemplo, backend-dom/uploads)
const uploadBaseDir = path.join(__dirname, '..', 'uploads');

// Define el directorio específico para las cargas de denuncias (por ejemplo, backend-dom/uploads/denuncias)
const uploadDenunciasDir = path.join(uploadBaseDir, 'denuncias');

// Asegúrate de que el directorio base exista
if (!fs.existsSync(uploadBaseDir)) {
    fs.mkdirSync(uploadBaseDir, { recursive: true });
}

// Asegúrate de que el directorio específico de denuncias exista
if (!fs.existsSync(uploadDenunciasDir)) {
    fs.mkdirSync(uploadDenunciasDir, { recursive: true });
}

// Configuración de almacenamiento para Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Guarda los archivos en la subcarpeta 'denuncias' dentro de 'uploads'
        cb(null, uploadDenunciasDir);
    },
    filename: (req, file, cb) => {
        // Genera un nombre de archivo único para evitar colisiones
        // Usamos el timestamp para asegurar unicidad y el originalname para mantener la extensión
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// Filtro para aceptar solo ciertos tipos de archivos
const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = [
        'image/jpeg',
        'image/png',
        'image/gif', // Opcional: si quieres permitir GIFs
        'image/webp', // Opcional: si quieres permitir WebP
        'application/pdf',
        'application/msword', // .doc
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // .docx
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true); // Aceptar el archivo
    } else {
        cb(new Error('Tipo de archivo no permitido. Solo JPG, PNG, GIF, WebP, PDF, DOC y DOCX son aceptados.'), false);
    }
};

// Configuración final de Multer
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // Límite de tamaño de archivo a 5MB (5 * 1024 * 1024 bytes)
    }
});

// Exporta la instancia de Multer configurada
module.exports = upload;