const pool = require('../config/db');
const fs = require('fs'); // Para eliminar archivos si hay un error en la DB
const path = require('path');

// Controlador para subir un archivo adjunto
exports.uploadAdjunto = async (req, res) => {
    // req.file contiene la información del archivo subido por Multer
    // req.body contendrá otros campos del formulario, como id_denuncia y descripcion

    if (!req.file) {
        return res.status(400).json({ message: 'No se ha subido ningún archivo.' });
    }

    const { id_denuncia, descripcion } = req.body;
    let id_usuario_carga = null; // Inicializamos a null

    // Determinar quién sube el archivo (usuario DOM o contribuyente)
    // Si no hay ninguno, id_usuario_carga permanecerá null, lo cual es permitido en la DB
    if (req.user && req.user.id) { // Si el request tiene info de un usuario DOM
        id_usuario_carga = req.user.id;
    } else if (req.contribuyente && req.contribuyente.id) { // Si el request tiene info de un contribuyente
        id_usuario_carga = req.contribuyente.id;
        // NOTA: La tabla Adjuntos tiene id_usuario_carga. Si un contribuyente sube,
        // esto guardará su ID de contribuyente en id_usuario_carga.
        // Esto puede requerir una FK a Usuarios Y a Contribuyentes,
        // o un campo adicional para distinguir el tipo de usuario que subió.
    }

    if (!id_denuncia) {
        // Si no hay id_denuncia, el archivo no tiene a qué adjuntarse, lo eliminamos
        fs.unlink(req.file.path, (err) => {
            if (err) console.error('Error al eliminar archivo tras falta de id_denuncia:', err);
        });
        return res.status(400).json({ message: 'Se requiere el ID de la denuncia para adjuntar el archivo.' });
    }

    // if (!id_usuario_carga) {
    //     // Si no hay un usuario autenticado para registrar como 'id_usuario_carga'
    //     fs.unlink(req.file.path, (err) => {
    //         if (err) console.error('Error al eliminar archivo tras falta de usuario de carga:', err);
    //     });
    //     return res.status(401).json({ message: 'No se pudo determinar el usuario que subió el archivo. Se requiere autenticación.' });
    // }

    // Información del archivo subido por Multer
    const { originalname, mimetype, size, filename, path: filePath } = req.file;

    try {
        // Guardar la información del adjunto en la base de datos
        const result = await pool.query(
            `INSERT INTO Adjuntos (
                id_denuncia,
                id_usuario_carga,
                nombre_archivo,
                tipo_archivo,
                ruta_almacenamiento,
                fecha_carga,
                descripcion
            ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)
            RETURNING *`, // Retorna todos los campos insertados
            [id_denuncia, id_usuario_carga, originalname, mimetype, filePath, descripcion]
        );

        res.status(201).json({
            message: 'Archivo adjunto subido y registrado exitosamente.',
            adjunto: result.rows[0]
        });

    } catch (error) {
        console.error('Error al registrar adjunto en la base de datos:', error);
        // Si hay un error al guardar en la DB, elimina el archivo físico para evitar basura
        fs.unlink(filePath, (err) => {
            if (err) console.error('Error al eliminar archivo después de fallo en DB:', err);
        });
        res.status(500).json({ message: 'Error interno del servidor al subir el adjunto.' });
    }
};

// Opcional: Controlador para obtener un adjunto (para descargar)
exports.getAdjunto = async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query('SELECT ruta_almacenamiento, nombre_archivo, tipo_archivo FROM Adjuntos WHERE id_adjunto = $1', [id]);
        const adjunto = result.rows[0];

        if (!adjunto) {
            return res.status(404).json({ message: 'Adjunto no encontrado.' });
        }

        // Envía el archivo al cliente
        res.download(adjunto.ruta_almacenamiento, adjunto.nombre_archivo, (err) => {
            if (err) {
                console.error('Error al descargar el archivo:', err);
                // Si el archivo no existe en la ruta, o hay otro error
                if (err.code === 'ENOENT') {
                    return res.status(404).json({ message: 'Archivo físico no encontrado en el servidor.' });
                }
                res.status(500).json({ message: 'Error al descargar el archivo.' });
            }
        });

    } catch (error) {
        console.error('Error al obtener adjunto de la base de datos:', error);
        res.status(500).json({ message: 'Error interno del servidor al obtener el adjunto.' });
    }
};

// Opcional: Controlador para eliminar un adjunto
exports.deleteAdjunto = async (req, res) => {
    const { id } = req.params; // ID del adjunto a eliminar

    try {
        // Primero, obtener la ruta del archivo para poder eliminarlo físicamente
        const result = await pool.query('SELECT ruta_almacenamiento FROM Adjuntos WHERE id_adjunto = $1', [id]);
        const adjunto = result.rows[0];

        if (!adjunto) {
            return res.status(404).json({ message: 'Adjunto no encontrado.' });
        }

        // Eliminar el registro de la base de datos
        const deleteResult = await pool.query('DELETE FROM Adjuntos WHERE id_adjunto = $1 RETURNING id_adjunto', [id]);

        if (deleteResult.rows.length === 0) {
            // Esto debería ser raro si adjunto fue encontrado, pero por seguridad
            return res.status(404).json({ message: 'Adjunto no encontrado en DB para eliminar (después de buscarlo).' });
        }

        // Eliminar el archivo físico del servidor
        fs.unlink(adjunto.ruta_almacenamiento, (err) => {
            if (err) {
                console.error('Advertencia: No se pudo eliminar el archivo físico del servidor:', err);
                // No detenemos la respuesta exitosa si el archivo físico no se elimina,
                // ya que el registro de la DB ya fue removido. Esto es una advertencia.
            } else {
                console.log(`Archivo ${adjunto.ruta_almacenamiento} eliminado físicamente.`);
            }
        });

        res.status(200).json({ message: 'Adjunto eliminado exitosamente.' });

    } catch (error) {
        console.error(`Error al eliminar adjunto con ID ${id}:`, error);
        res.status(500).json({ message: 'Error interno del servidor al eliminar el adjunto.' });
    }
};