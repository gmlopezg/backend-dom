const pool = require('../config/db'); // Importa la conexión a la DB
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// --- Obtener todos los usuarios (Rol: Administrador/Director) ---
exports.getUsuarios = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                id_usuario, 
                nombre_usuario, 
                p_apellido_usuario, 
                s_apellido_usuario, 
                email, 
                rol 
            FROM Usuarios
            ORDER BY id_usuario DESC
        `);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error al obtener usuarios:', error);
        res.status(500).json({ message: 'Error interno del servidor al obtener usuarios.' });
    }
};

// --- Obtener un usuario DOM por ID (Rol: Administrador/Director) ---
exports.getUsuarioById = async (req, res) => {
    const { id } = req.params;

    if (isNaN(id)) {
        return res.status(400).json({ message: 'ID de usuario inválido.' });
    }

    try {
        const result = await pool.query(
            `SELECT
                id_usuario,
                nombre_usuario,
                p_apellido_usuario,
                s_apellido_usuario,
                email,
                rol
            FROM Usuarios
            WHERE id_usuario = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Usuario no encontrado.' });
        }

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error(`Error al obtener usuario con ID ${id}:`, error);
        res.status(500).json({ message: 'Error interno del servidor al obtener usuario.' });
    }
};

// --- Registrar un nuevo usuario DOM (Rol: Administrador) ---
exports.registerUsuario = async (req, res) => {
    const { nombre_usuario, p_apellido_usuario, s_apellido_usuario, email, password, rol } = req.body;

    // s_apellido_usuario puede ser nulo en la BD, así que lo hacemos opcional aquí.
    if (!nombre_usuario || !p_apellido_usuario || !email || !password || !rol) {
        return res.status(400).json({ message: 'Los campos nombre, primer apellido, email, password y rol son obligatorios.' });
    }

    // Validar el rol para asegurar que sea uno de los permitidos para usuarios DOM
    const allowedRoles = ['administrador', 'director_de_obras', 'inspector'];
    if (!allowedRoles.includes(rol)) {
        return res.status(400).json({ message: 'Rol de usuario no válido. Los roles permitidos son: administrador, director_de_obras, inspector.' });
    }

    try {
        const existingUser = await pool.query('SELECT id_usuario FROM Usuarios WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ message: 'El email ya está registrado.' });
        }

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        // Si s_apellido_usuario no viene, se inserta null.
        const result = await pool.query(
            `INSERT INTO Usuarios (
                nombre_usuario,
                p_apellido_usuario,
                s_apellido_usuario,
                email,
                password_hash,
                rol
            ) VALUES ($1, $2, $3, $4, $5, $6) 
            RETURNING id_usuario, nombre_usuario, p_apellido_usuario, s_apellido_usuario, email, rol`, // Retornamos más campos para confirmación
            [nombre_usuario, p_apellido_usuario, s_apellido_usuario || null, email, password_hash, rol]
        );

        res.status(201).json({
            message: 'Usuario registrado exitosamente.',
            user: result.rows[0]
        });

    } catch (error) {
        console.error('Error al registrar usuario:', error);
        res.status(500).json({ message: 'Error interno del servidor al registrar el usuario.' });
    }
};

// --- Actualizar un usuario DOM (Rol: Administrador) ---
exports.updateUsuario = async (req, res) => {
    const { id } = req.params;
    const { nombre_usuario, p_apellido_usuario, s_apellido_usuario, email, password, rol } = req.body;

    if (isNaN(id)) {
        return res.status(400).json({ message: 'ID de usuario inválido.' });
    }

    // Validar el rol (si se proporciona)
    const allowedRoles = ['administrador', 'director_de_obras', 'inspector'];
    if (rol && !allowedRoles.includes(rol)) {
        return res.status(400).json({ message: 'Rol de usuario no válido. Los roles permitidos son: administrador, director_de_obras, inspector.' });
    }

    try {
        let updateQuery = `
            UPDATE Usuarios
            SET
                nombre_usuario = COALESCE($1, nombre_usuario),
                p_apellido_usuario = COALESCE($2, p_apellido_usuario),
                s_apellido_usuario = COALESCE($3, s_apellido_usuario),
                email = COALESCE($4, email),
                rol = COALESCE($5, rol)
        `;
        const queryParams = [nombre_usuario, p_apellido_usuario, s_apellido_usuario, email, rol];
        let paramIndex = 6;

        // Si se proporciona una nueva contraseña, se hashea y se añade a la consulta
        if (password) {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            updateQuery += `, password_hash = $${paramIndex++}`;
            queryParams.push(hashedPassword);
        }

        updateQuery += ` WHERE id_usuario = $${paramIndex} RETURNING id_usuario, nombre_usuario, p_apellido_usuario, s_apellido_usuario, email, rol`;
        queryParams.push(id);

        const result = await pool.query(updateQuery, queryParams);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Usuario no encontrado.' });
        }

        res.status(200).json({
            message: 'Usuario actualizado exitosamente.',
            user: result.rows[0]
        });

    } catch (error) {
        console.error(`Error al actualizar usuario con ID ${id}:`, error);
        res.status(500).json({ message: 'Error interno del servidor al actualizar usuario.' });
    }
};

// --- Función de login para usuarios internos (Director, Inspector, Administrador) ---
exports.loginUsuario = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email y contraseña son obligatorios.' });
    }

    try {
        // Asegurar que se selecciona nombre_usuario y rol
        const result = await pool.query(
            'SELECT id_usuario, nombre_usuario, p_apellido_usuario, s_apellido_usuario, email, password_hash, rol FROM Usuarios WHERE email = $1',
            [email]
        );
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ message: 'Credenciales inválidas.' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Credenciales inválidas.' });
        }

        // Generar token JWT
        const token = jwt.sign(
            { id: user.id_usuario, email: user.email, rol: user.rol },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        // Devolver la respuesta con el token y los datos del usuario (incluyendo nombre_usuario y rol)
        res.status(200).json({
            message: 'Inicio de sesión exitoso.',
            token,
            user: {
                id_usuario: user.id_usuario,
                nombre_usuario: user.nombre_usuario, // Aseguramos que se envía el nombre
                p_apellido_usuario: user.p_apellido_usuario,
                s_apellido_usuario: user.s_apellido_usuario,
                email: user.email,
                rol: user.rol // Aseguramos que se envía el rol
            }
        });

    } catch (error) {
        console.error('Error en el login de usuario interno:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
};

// --- Eliminar un usuario DOM (Rol: Administrador/Director) ---
exports.deleteUsuario = async (req, res) => {
    const { id } = req.params; // ID del usuario a eliminar

    if (isNaN(id)) {
        return res.status(400).json({ message: 'ID de usuario inválido.' });
    }

    const client = await pool.connect(); // Obtener un cliente de la pool para la transacción
    try {
        await client.query('BEGIN'); // Iniciar la transacción

        console.log(`Backend: Iniciando eliminación en cascada para usuario ID: ${id}`);

        // 1. Desvincular al usuario de las tablas que lo referencian con ON DELETE SET NULL
        //    (o eliminar registros si esa fuera la lógica de negocio para otras tablas)

        // Desvincular de Asignacion_Denuncia: establecer id_responsable a NULL
        await client.query(
            'UPDATE Asignacion_Denuncia SET id_responsable = NULL WHERE id_responsable = $1',
            [id]
        );
        console.log(`Backend: Asignaciones de denuncia desvinculadas del usuario ${id}.`);

        // Desvincular de Estado_Denuncia: establecer id_responsable a NULL
        await client.query(
            'UPDATE Estado_Denuncia SET id_responsable = NULL WHERE id_responsable = $1',
            [id]
        );
        console.log(`Backend: Estados de denuncia desvinculados del usuario ${id}.`);

        // NUEVO: Desvincular de Comentario_Interno: establecer id_usuario a NULL
        await client.query(
            'UPDATE Comentario_Interno SET id_usuario = NULL WHERE id_usuario = $1',
            [id]
        );
        console.log(`Backend: Comentarios internos desvinculados del usuario ${id}.`);


        // Si el usuario puede ser un denunciante (aunque no es el caso típico para DOM):
        // await client.query('UPDATE Denunciante SET id_usuario = NULL WHERE id_usuario = $1', [id]);

        // 2. Finalmente, eliminar el usuario de la tabla Usuarios
        const result = await client.query('DELETE FROM Usuarios WHERE id_usuario = $1 RETURNING id_usuario', [id]);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK'); // Si el usuario no se encontró, revertir la transacción
            return res.status(404).json({ message: 'Usuario no encontrado para eliminar.' });
        }

        await client.query('COMMIT'); // Confirmar todos los cambios si todo fue exitoso
        console.log(`Backend: Usuario ${id} y sus referencias asociadas eliminados/desvinculados exitosamente.`);
        res.status(200).json({ message: 'Usuario eliminado exitosamente.', id_usuario: result.rows[0].id_usuario });

    } catch (error) {
        await client.query('ROLLBACK'); // Revertir todos los cambios si ocurre algún error
        console.error(`Backend: Error al eliminar usuario con ID ${id}:`, error);
        // Si el error es una violación de clave foránea no manejada, dar un mensaje más específico
        if (error.code === '23503') {
            res.status(409).json({ message: 'Conflicto: No se puede eliminar el usuario porque aún tiene registros asociados en una tabla no manejada. Por favor, contacta al administrador.', details: error.detail });
        } else {
            res.status(500).json({ message: 'Error interno del servidor al eliminar usuario.' });
        }
    } finally {
        client.release(); // Liberar el cliente de la pool
    }
};
