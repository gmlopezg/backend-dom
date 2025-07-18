// --- controllers/contribuyenteController.js ---
const pool = require('../config/db'); // Asegúrate de la ruta correcta a tu pool de conexiones
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Función para Registrar un Nuevo Contribuyente
exports.registerContribuyente = async (req, res) => {
    const { nombre_contribuyente, p_apellido_contribuyente, s_apellido_contribuyente, rut, email_contribuyente, telefono, password } = req.body;

    if (!email_contribuyente || !password || !rut) {
        return res.status(400).json({ message: 'Email, contraseña y RUT son obligatorios para el registro del contribuyente.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const existingContribuyente = await client.query('SELECT id_contribuyente FROM Contribuyente WHERE email_contribuyente = $1', [email_contribuyente]);
        if (existingContribuyente.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: 'El email de contribuyente ya está registrado.' });
        }

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        const result = await client.query(
            'INSERT INTO Contribuyente (nombre_contribuyente, p_apellido_contribuyente, s_apellido_contribuyente, rut, email_contribuyente, telefono, password_hash, fecha_registro) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING id_contribuyente, nombre_contribuyente, p_apellido_contribuyente, email_contribuyente, fecha_registro',
            [nombre_contribuyente, p_apellido_contribuyente, s_apellido_contribuyente, rut, email_contribuyente, telefono, password_hash]
        );
        const newContribuyente = result.rows[0];

        // Buscar Denunciante existente con el mismo email y vincularlo
        const findDenuncianteQuery = 'SELECT id_denunciante FROM Denunciante WHERE email_denunciante = $1';
        const existingDenuncianteResult = await client.query(findDenuncianteQuery, [email_contribuyente]);

        if (existingDenuncianteResult.rows.length > 0) {
            const denuncianteId = existingDenuncianteResult.rows[0].id_denunciante;
            const updateDenuncianteQuery = 'UPDATE Denunciante SET id_contribuyente = $1 WHERE id_denunciante = $2';
            await client.query(updateDenuncianteQuery, [newContribuyente.id_contribuyente, denuncianteId]);
            console.log(`Denunciante con ID ${denuncianteId} vinculado a Contribuyente con ID ${newContribuyente.id_contribuyente}`);
        }

        await client.query('COMMIT');

        // Generar token JWT para el nuevo contribuyente
        const token = jwt.sign(
            { id: newContribuyente.id_contribuyente, email: newContribuyente.email_contribuyente, rol: 'contribuyente' },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.status(201).json({
            message: 'Contribuyente registrado exitosamente y denuncias existentes enlazadas.',
            contribuyente: {
                id_contribuyente: newContribuyente.id_contribuyente,
                nombre_contribuyente: newContribuyente.nombre_contribuyente, // Asegura que el nombre se envíe en la respuesta
                p_apellido_contribuyente: newContribuyente.p_apellido_contribuyente,
                email_contribuyente: newContribuyente.email_contribuyente,
                fecha_registro: newContribuyente.fecha_registro
            },
            token
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al registrar contribuyente:', error);
        res.status(500).json({ message: 'Error interno del servidor al registrar el contribuyente.' });
    } finally {
        client.release();
    }
};

// Función para Iniciar Sesión de Contribuyentes
exports.loginContribuyente = async (req, res) => {
    const { email_contribuyente, password } = req.body;

    if (!email_contribuyente || !password) {
        return res.status(400).json({ message: 'Email y contraseña son obligatorios.' });
    }

    try {
        const result = await pool.query('SELECT id_contribuyente, nombre_contribuyente, p_apellido_contribuyente, email_contribuyente, password_hash FROM Contribuyente WHERE email_contribuyente = $1', [email_contribuyente]);
        const contribuyente = result.rows[0];

        if (!contribuyente) {
            return res.status(401).json({ message: 'Credenciales inválidas.' });
        }

        const isMatch = await bcrypt.compare(password, contribuyente.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Credenciales inválidas.' });
        }

        const token = jwt.sign(
            { id: contribuyente.id_contribuyente, email: contribuyente.email_contribuyente, rol: 'contribuyente' },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.status(200).json({
            message: 'Inicio de sesión exitoso.',
            token,
            contribuyente: {
                id_contribuyente: contribuyente.id_contribuyente,
                nombre_contribuyente: contribuyente.nombre_contribuyente || contribuyente.email_contribuyente, // Asegura que el nombre se envíe para el frontend
                p_apellido_contribuyente: contribuyente.p_apellido_contribuyente,
                email_contribuyente: contribuyente.email_contribuyente
            }
        });

    } catch (error) {
        console.error('Error en el login de contribuyente:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
};

// Nueva función para obtener denuncias por ID de contribuyente
exports.getDenunciasByContribuyenteId = async (req, res) => {
    const contribuyenteId = parseInt(req.params.id); // Obtiene el ID del contribuyente de la URL

    // Esta validación asume que tu middleware 'authContribuyente' adjunta 'req.user.id' y 'req.user.rol'
    // Si tu middleware adjunta 'req.contribuyente.id_contribuyente', ajusta esta línea.
    if (!req.user || (req.user.id !== contribuyenteId && req.user.rol !== 'Administrador' && req.user.rol !== 'Director')) {
        return res.status(403).json({ message: 'Acceso denegado. No tienes permiso para ver estas denuncias.' });
    }

    try {
        const query = `
            SELECT
                d.id_denuncia,
                d.public_id,
                d.titulo,
                d.descripcion AS descripcion_denuncia,
                d.direccion_incidente,
                d.comuna,
                d.fecha_creacion,
                ed.estado AS estado_actual,
                ed.fecha_estado AS fecha_estado_actual,
                COALESCE(u.nombre_usuario || ' ' || u.p_apellido_usuario, 'No Asignado') AS inspector_asignado
            FROM
                Denuncia d
            LEFT JOIN
                Denunciante dn ON d.id_denunciante = dn.id_denunciante
            LEFT JOIN
                Estado_Denuncia ed ON d.id_denuncia = ed.id_denuncia AND ed.fecha_estado = (
                    SELECT MAX(fecha_estado) FROM Estado_Denuncia WHERE id_denuncia = d.id_denuncia
                )
            LEFT JOIN
                Asignacion_Denuncia ad ON d.id_denuncia = ad.id_denuncia AND ad.fecha_asignacion = (
                    SELECT MAX(fecha_asignacion) FROM Asignacion_Denuncia WHERE id_denuncia = d.id_denuncia
                )
            LEFT JOIN
                Usuarios u ON ad.id_responsable = u.id_usuario
            WHERE
                dn.id_contribuyente = $1
            ORDER BY
                d.fecha_creacion DESC;
        `;

        const result = await pool.query(query, [contribuyenteId]);

        res.status(200).json(result.rows);

    } catch (error) {
        console.error('Error al obtener denuncias del contribuyente:', error);
        res.status(500).json({ message: 'Error interno del servidor al obtener las denuncias.' });
    }
};


// --- Funciones de Controlador para Administrador (esqueletos, si las tienes implementadas, úsalas) ---

exports.getContribuyentes = async (req, res) => {
    try {
        const result = await pool.query('SELECT id_contribuyente, nombre_contribuyente, p_apellido_contribuyente, email_contribuyente, rut, telefono, fecha_registro FROM Contribuyente ORDER BY fecha_registro DESC');
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error al obtener todos los contribuyentes:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
};

exports.getContribuyenteById = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT id_contribuyente, nombre_contribuyente, p_apellido_contribuyente, email_contribuyente, rut, telefono, fecha_registro FROM Contribuyente WHERE id_contribuyente = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Contribuyente no encontrado.' });
        }
        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Error al obtener contribuyente por ID:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
};

exports.updateContribuyente = async (req, res) => {
    const { id } = req.params;
    const { nombre_contribuyente, p_apellido_contribuyente, s_apellido_contribuyente, rut, email_contribuyente, telefono } = req.body;
    try {
        const result = await pool.query(
            'UPDATE Contribuyente SET nombre_contribuyente = $1, p_apellido_contribuyente = $2, s_apellido_contribuyente = $3, rut = $4, email_contribuyente = $5, telefono = $6 WHERE id_contribuyente = $7 RETURNING *',
            [nombre_contribuyente, p_apellido_contribuyente, s_apellido_contribuyente, rut, email_contribuyente, telefono, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Contribuyente no encontrado para actualizar.' });
        }
        res.status(200).json({ message: 'Contribuyente actualizado exitosamente.', contribuyente: result.rows[0] });
    } catch (error) {
        console.error('Error al actualizar contribuyente:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
};

exports.deleteContribuyente = async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Primero, desvincular denunciantes de este contribuyente (si la relación es CASCADE ON DELETE, esto no sería necesario)
        await client.query('UPDATE Denunciante SET id_contribuyente = NULL WHERE id_contribuyente = $1', [id]);
        console.log(`Denunciantes desvinculados del contribuyente ${id}.`);

        const result = await client.query('DELETE FROM Contribuyente WHERE id_contribuyente = $1 RETURNING id_contribuyente', [id]);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Contribuyente no encontrado para eliminar.' });
        }

        await client.query('COMMIT');
        res.status(200).json({ message: `Contribuyente con ID ${id} eliminado exitosamente.` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al eliminar contribuyente:', error);
        if (error.code === '23503') { // Foreign key violation
            res.status(409).json({ message: 'No se puede eliminar el contribuyente porque aún tiene referencias activas en otras tablas.' });
        } else {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    } finally {
        client.release();
    }
};