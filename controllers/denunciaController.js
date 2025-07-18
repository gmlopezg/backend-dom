const pool = require('../config/db'); // Importa la conexión a la DB
const { sendEmail } = require('../utils/mailer');

// Obtener todas las denuncias
exports.getDenuncias = async (req, res) => {
    try {
        // Extraer parámetros de consulta
        const { estado, tipo_denuncia, comuna, q } = req.query; // 'q' para búsqueda por palabra clave

        let queryBase = `
            SELECT
                d.id_denuncia,
                d.tipo_denuncia,
                d.titulo,
                d.descripcion AS descripcion_denuncia,
                d.direccion_incidente,
                d.comuna,
                d.fecha_ingreso AS fecha_creacion,
                d.id_denunciante,
                d.id_denunciado,
                c_denunciante.email_contribuyente AS email_denunciante,
                c_denunciado.email_contribuyente AS email_denunciado
            FROM Denuncia d
            LEFT JOIN Contribuyente c_denunciante ON d.id_denunciante = c_denunciante.id_contribuyente
            LEFT JOIN Contribuyente c_denunciado ON d.id_denunciado = c_denunciado.id_contribuyente
        `;

        const queryParams = [];
        const conditions = [];
        let paramIndex = 1;

        // Añadir condiciones de filtro
        if (tipo_denuncia) {
            conditions.push(`d.tipo_denuncia ILIKE $${paramIndex++}`);
            queryParams.push(`%${tipo_denuncia}%`); // Usamos ILIKE para búsqueda insensible a mayúsculas/minúsculas y % para búsqueda parcial
        }
        if (comuna) {
            conditions.push(`d.comuna ILIKE $${paramIndex++}`);
            queryParams.push(`%${comuna}%`);
        }
        // Para el filtro por estado, necesitamos unir con Estado_Denuncia para obtener el último estado
        
        // Añadir condición de búsqueda por palabra clave (q)
        if (q) {
            conditions.push(`(d.titulo ILIKE $${paramIndex} OR d.descripcion ILIKE $${paramIndex})`);
            queryParams.push(`%${q}%`);
            paramIndex++;
        }

        if (conditions.length > 0) {
            queryBase += ` WHERE ` + conditions.join(' AND ');
        }

        queryBase += ` ORDER BY d.fecha_ingreso DESC`; // Ordenar siempre por fecha

        // Ejecutar la consulta principal para obtener las denuncias base (sin el estado aún)
        const denunciasResult = await pool.query(queryBase, queryParams);
        let denuncias = denunciasResult.rows;

        if (denuncias.length === 0) {
            return res.status(200).json([]);
        }

        // Obtener los IDs de las denuncias obtenidas para las subconsultas eficientes
        const denunciaIds = denuncias.map(d => d.id_denuncia);

        // Obtener el último estado para cada denuncia (solo para las denuncias obtenidas)
        // Usamos IN para filtrar por los IDs de denuncias que ya tenemos
        const latestStatesResult = await pool.query(
            `SELECT DISTINCT ON (id_denuncia)
                id_denuncia,
                estado,
                fecha_ultima_actualizacion
            FROM Estado_Denuncia
            WHERE id_denuncia IN (${denunciaIds.join(',')})
            ORDER BY id_denuncia, fecha_ultima_actualizacion DESC`
        );
        const latestStatesMap = new Map();
        latestStatesResult.rows.forEach(row => {
            latestStatesMap.set(row.id_denuncia, {
                estado_actual: row.estado,
                fecha_estado_actual: row.fecha_ultima_actualizacion
            });
        });

        // Obtener la última asignación para cada denuncia (solo para las denuncias obtenidas)
        const latestAssignmentsResult = await pool.query(
            `SELECT DISTINCT ON (ad.id_denuncia)
                ad.id_denuncia,
                ad.id_responsable AS id_inspector_asignado,
                CONCAT(u.nombre_usuario, ' ', u.p_apellido_usuario, ' ', u.s_apellido_usuario) AS nombre_inspector_asignado,
                ad.fecha_asignacion
            FROM Asignacion_Denuncia ad
            JOIN usuarios u ON ad.id_responsable = u.id_usuario
            WHERE ad.id_denuncia IN (${denunciaIds.join(',')})
            ORDER BY ad.id_denuncia, ad.fecha_asignacion DESC`
        );
        const latestAssignmentsMap = new Map();
        latestAssignmentsResult.rows.forEach(row => {
            latestAssignmentsMap.set(row.id_denuncia, {
                id_inspector_asignado: row.id_inspector_asignado,
                nombre_inspector_asignado: row.nombre_inspector_asignado,
                fecha_asignacion_actual: row.fecha_asignacion
            });
        });

        // Adjuntar el último estado y la última asignación a cada denuncia
        // Y aplicar el filtro final por 'estado' si se especificó
        const filteredDenuncias = [];
        for (const denuncia of denuncias) {
            const latestState = latestStatesMap.get(denuncia.id_denuncia);
            if (latestState) {
                denuncia.estado_actual = latestState.estado_actual;
                denuncia.fecha_estado_actual = latestState.fecha_estado_actual;
            } else {
                denuncia.estado_actual = null;
                denuncia.fecha_estado_actual = null;
            }

            // Aplicar filtro por 'estado_actual' aquí
            if (estado && denuncia.estado_actual !== estado) {
                continue; // Saltar esta denuncia si no coincide con el estado solicitado
            }

            const latestAssignment = latestAssignmentsMap.get(denuncia.id_denuncia);
            if (latestAssignment) {
                denuncia.id_inspector_asignado = latestAssignment.id_inspector_asignado;
                denuncia.nombre_inspector_asignado = latestAssignment.nombre_inspector_asignado;
                denuncia.fecha_asignacion_actual = latestAssignment.fecha_asignacion_actual;
            } else {
                denuncia.id_inspector_asignado = null;
                denuncia.nombre_inspector_asignado = null;
                denuncia.fecha_asignacion_actual = null;
            }
        }

        // Obtener todos los adjuntos de una sola vez para todas las denuncias filtradas
        const allAdjuntosResult = await pool.query(
            `SELECT
                id_adjunto,
                id_denuncia,
                nombre_archivo,
                tipo_archivo,
                ruta_almacenamiento,
                fecha_carga,
                descripcion,
                id_usuario_carga
            FROM Adjuntos
            WHERE id_denuncia IN (${denunciaIds.join(',')})`
        );

        const adjuntosMap = new Map();
        allAdjuntosResult.rows.forEach(adj => {
            if (!adjuntosMap.has(adj.id_denuncia)) {
                adjuntosMap.set(adj.id_denuncia, []);
            }
            adjuntosMap.get(adj.id_denuncia).push({
                id: adj.id_adjunto,
                nombre: adj.nombre_archivo,
                tipo: adj.tipo_archivo,
                ruta_almacenamiento: adj.ruta_almacenamiento,
                fecha_carga: adj.fecha_carga,
                descripcion: adj.descripcion,
                id_usuario_carga: adj.id_usuario_carga
            });
        });

        denuncias.forEach(denuncia => {
            denuncia.adjuntos = adjuntosMap.get(denuncia.id_denuncia) || [];
            // Si la denuncia fue filtrada por estado en el bucle anterior, ya está lista.
            // Si no hay filtro de estado, todas las denuncias con adjuntos serán añadidas.
        });

 
        // Lógica del filtro de estado para que sea explícita
        const finalDenuncias = denuncias.filter(d => {
            // Si 'estado' es null o undefined, no se aplica este filtro
            if (!estado) return true;
            return d.estado_actual === estado;
        });


        res.status(200).json(finalDenuncias);

    } catch (error) {
        console.error('Error al obtener todas las denuncias:', error);
        res.status(500).json({ message: 'Error interno del servidor al obtener las denuncias.' });
    }
};

// Obtener una denuncia por ID
exports.getDenunciaById = async (req, res) => {
    const { id } = req.params; // ID de la denuncia

    if (isNaN(id)) {
        return res.status(400).json({ message: 'ID de denuncia inválido.' });
    }

    try {
        // Consultar la denuncia principal junto con su último estado y última asignación
        const denunciaResult = await pool.query(
            `SELECT
                d.id_denuncia,
                d.tipo_denuncia,
                d.titulo,
                d.descripcion AS descripcion_denuncia,
                d.direccion_incidente,
                d.comuna,
                d.fecha_ingreso AS fecha_creacion,
                d.id_denunciante,
                d.id_denunciado,
                c_denunciante.email_contribuyente AS email_denunciante,
                c_denunciado.email_contribuyente AS email_denunciado,
                -- Obtener el último estado
                (SELECT ed.estado
                 FROM Estado_Denuncia ed
                 WHERE ed.id_denuncia = d.id_denuncia
                 ORDER BY ed.fecha_ultima_actualizacion DESC
                 LIMIT 1) AS estado_actual,
                (SELECT ed.fecha_ultima_actualizacion
                 FROM Estado_Denuncia ed
                 WHERE ed.id_denuncia = d.id_denuncia
                 ORDER BY ed.fecha_ultima_actualizacion DESC
                 LIMIT 1) AS fecha_estado_actual,
                -- Obtener la última asignación
                (SELECT ad.id_responsable
                 FROM Asignacion_Denuncia ad
                 WHERE ad.id_denuncia = d.id_denuncia
                 ORDER BY ad.fecha_asignacion DESC
                 LIMIT 1) AS id_inspector_asignado,
                (SELECT CONCAT(u.nombre_usuario, ' ', u.p_apellido_usuario, ' ', u.s_apellido_usuario) -- <--- CORRECCIÓN AQUÍ
                 FROM Asignacion_Denuncia ad
                 JOIN usuarios u ON ad.id_responsable = u.id_usuario
                 WHERE ad.id_denuncia = d.id_denuncia
                 ORDER BY ad.fecha_asignacion DESC
                 LIMIT 1) AS nombre_inspector_asignado,
                (SELECT ad.fecha_asignacion
                 FROM Asignacion_Denuncia ad
                 WHERE ad.id_denuncia = d.id_denuncia
                 ORDER BY ad.fecha_asignacion DESC
                 LIMIT 1) AS fecha_asignacion_actual
            FROM Denuncia d
            LEFT JOIN Contribuyente c_denunciante ON d.id_denunciante = c_denunciante.id_contribuyente
            LEFT JOIN Contribuyente c_denunciado ON d.id_denunciado = c_denunciado.id_contribuyente
            WHERE d.id_denuncia = $1`,
            [id]
        );

        if (denunciaResult.rows.length === 0) {
            return res.status(404).json({ message: 'Denuncia no encontrada.' });
        }

        const denuncia = denunciaResult.rows[0];

        // Consultar los adjuntos asociados a esta denuncia
        const adjuntosResult = await pool.query(
            `SELECT
                id_adjunto,
                nombre_archivo,
                tipo_archivo,
                ruta_almacenamiento,
                fecha_carga,
                descripcion,
                id_usuario_carga
            FROM Adjuntos
            WHERE id_denuncia = $1`,
            [id]
        );

        denuncia.adjuntos = adjuntosResult.rows.map(adj => ({
            id: adj.id_adjunto,
            nombre: adj.nombre_archivo,
            tipo: adj.tipo_archivo,
            ruta_almacenamiento: adj.ruta_almacenamiento,
            fecha_carga: adj.fecha_carga,
            descripcion: adj.descripcion,
            id_usuario_carga: adj.id_usuario_carga
        }));

        // Consultar los avances asociados a esta denuncia
        const avancesResult = await pool.query(
            `SELECT
                ad.id_avance,
                ad.comentario,
                ad.fecha_avance,
                u.nombre_usuario,
                u.p_apellido_usuario,
                u.s_apellido_usuario
            FROM Avance_Denuncia ad
            JOIN Usuarios u ON ad.id_usuario_responsable = u.id_usuario
            WHERE ad.id_denuncia = $1
            ORDER BY ad.fecha_avance ASC`,
            [id]
        );

        // Para cada avance, buscar sus adjuntos específicos
        const avancesConAdjuntos = await Promise.all(avancesResult.rows.map(async (avance) => {
            const adjuntosAvanceResult = await pool.query(
                `SELECT id_adjunto, nombre_archivo, tipo_archivo, ruta_almacenamiento, fecha_carga
                 FROM Adjuntos
                 WHERE id_avance_asociado = $1
                 ORDER BY fecha_carga ASC`,
                [avance.id_avance]
            );
            return {
                ...avance,
                nombre_usuario_responsable: `${avance.nombre_usuario} ${avance.p_apellido_usuario} ${avance.s_apellido_usuario}`,
                adjuntos_del_avance: adjuntosAvanceResult.rows
            };
        }));

        denuncia.avances = avancesConAdjuntos;

        res.status(200).json(denuncia);

    } catch (error) {
        console.error(`Error al obtener denuncia con ID ${id}:`, error);
        res.status(500).json({ message: 'Error interno del servidor al obtener la denuncia.' });
    }
};

// Obtener el historial completo de estados y asignaciones de una denuncia
exports.getDenunciaHistory = async (req, res) => {
    const { id } = req.params; // ID de la denuncia

    if (isNaN(id)) {
        return res.status(400).json({ message: 'ID de denuncia inválido.' });
    }

    try {
        // 1. Verificar si la denuncia existe
        const denunciaExists = await pool.query('SELECT id_denuncia FROM Denuncia WHERE id_denuncia = $1', [id]);
        if (denunciaExists.rows.length === 0) {
            return res.status(404).json({ message: 'Denuncia no encontrada.' });
        }

        // 2. Obtener el historial de estados de la denuncia
        const estadosHistoryResult = await pool.query(
            `SELECT
                id_estado,
                estado,
                fecha_ultima_actualizacion
            FROM Estado_Denuncia
            WHERE id_denuncia = $1
            ORDER BY fecha_ultima_actualizacion ASC`, // Ordenar cronológicamente
            [id]
        );

        // 3. Obtener el historial de asignaciones de la denuncia
        const asignacionesHistoryResult = await pool.query(
            `SELECT
                ad.id_asignacion,
                ad.id_responsable AS id_inspector_asignado,
                CONCAT(u.nombre_usuario, ' ', u.p_apellido_usuario, ' ', u.s_apellido_usuario) AS nombre_inspector_asignado,
                ad.fecha_asignacion
            FROM Asignacion_Denuncia ad
            JOIN usuarios u ON ad.id_responsable = u.id_usuario
            WHERE ad.id_denuncia = $1
            ORDER BY ad.fecha_asignacion ASC`, // Ordenar cronológicamente
            [id]
        );

        res.status(200).json({
            id_denuncia: id,
            historial_estados: estadosHistoryResult.rows,
            historial_asignaciones: asignacionesHistoryResult.rows
        });

    } catch (error) {
        console.error(`Error al obtener el historial de la denuncia con ID ${id}:`, error);
        res.status(500).json({ message: 'Error interno del servidor al obtener el historial de la denuncia.' });
    }
};

// Crear una nueva denuncia
exports.createDenuncia = async (req, res) => {
    const { tipo_denuncia, titulo, descripcion, direccion_incidente, comuna, id_denunciante, id_denunciado } = req.body;

    // Obtener el ID del usuario que está creando la denuncia (si está autenticado)
    // Esto asume que tienes un middleware de autenticación que adjunta req.user o req.contribuyente
    let id_usuario_creador = null;
    if (req.user && req.user.id) { // Si es un usuario DOM
        id_usuario_creador = req.user.id;
    } else if (req.contribuyente && req.contribuyente.id) { // Si es un contribuyente
        id_usuario_creador = req.contribuyente.id;
    }
    // NOTA: Si id_responsable en ESTADO_DENUNCIA es estrictamente FK a "inspector",
    // y la denuncia la crea un contribuyente, este id_usuario_creador no servirá directamente.
    // En ese caso, se necesitaría un ID de "usuario sistema" o que id_responsable sea NULLABLE.

    if (!tipo_denuncia || !titulo || !descripcion || !direccion_incidente || !comuna) {
        return res.status(400).json({ message: 'Todos los campos obligatorios de la denuncia (tipo, título, descripción, dirección, comuna) son requeridos.' });
    }

    try {
        // Iniciar una transacción para asegurar atomicidad
        await pool.query('BEGIN');

        // 1. Insertar la denuncia principal
        const denunciaResult = await pool.query(
            'INSERT INTO Denuncia (tipo_denuncia, titulo, descripcion, direccion_incidente, comuna, fecha_ingreso, id_denunciante, id_denunciado) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7) RETURNING id_denuncia',
            [tipo_denuncia, titulo, descripcion, direccion_incidente, comuna, id_denunciante, id_denunciado]
        );
        const newDenunciaId = denunciaResult.rows[0].id_denuncia;

        // 2. Insertar el estado inicial en ESTADO_DENUNCIA
        const estadoInicial = 'Registrada sin asignar'; // Estado por defecto
        let responsableIdForState = null; // Por defecto, no hay responsable asignado al inicio

        // Si el usuario creador es un DOM user (inspector/admin/director), se puede usar su ID como responsable inicial
        // Si no, o si es un contribuyente, y id_responsable es NO NULL, necesitarías un ID de sistema o hacer la columna nullable.
        // Para este ejemplo, si id_usuario_creador es un DOM user, lo usamos. Si no, o si es un contribuyente, lo dejamos NULL.
        // Esto requiere que id_responsable en ESTADO_DENUNCIA sea NULLABLE.
        // Si no es NULLABLE y la crea un contribuyente, fallará aquí.
        if (req.user && (req.user.rol === 'administrador' || req.user.rol === 'inspector' || req.user.rol === 'director')) {
             responsableIdForState = req.user.id;
        }
        // Si id_responsable es NO NULL y la crea un contribuyente, aquí deberías usar un ID de "usuario sistema" predefinido.
        // Ejemplo: responsableIdForState = ID_DE_USUARIO_SISTEMA;

        await pool.query(
            'INSERT INTO ESTADO_DENUNCIA (id_denuncia, estado, fecha_ultima_actualizacion, id_responsable) VALUES ($1, $2, NOW(), $3)',
            [newDenunciaId, estadoInicial, responsableIdForState]
        );

        // Confirmar la transacción
        await pool.query('COMMIT');

        res.status(201).json({
            message: 'Denuncia creada y estado inicial registrado exitosamente.',
            denuncia: {
                id_denuncia: newDenunciaId,
                tipo_denuncia,
                titulo,
                descripcion,
                direccion_incidente,
                comuna,
                id_denunciante,
                id_denunciado,
                estado_inicial: estadoInicial
            }
        });

    } catch (error) {
        // Revertir la transacción en caso de error
        await pool.query('ROLLBACK');
        console.error('Error al crear denuncia y/o registrar estado inicial:', error);
        if (error.code === '23503') {
            return res.status(400).json({ message: 'El ID de denunciante o denunciado proporcionado no existe, o hay un problema con el responsable del estado inicial.', details: error.detail });
        }
        res.status(500).json({ message: 'Error interno del servidor al crear la denuncia.' });
    }
};

// Actualizar una denuncia por ID
exports.updateDenuncia = async (req, res) => {
    const idDenuncia = parseInt(req.params.id);
    const { tipo_denuncia, titulo, descripcion, direccion_incidente, comuna, id_denunciante, id_denunciado } = req.body;

    if (isNaN(idDenuncia)) {
        return res.status(400).json({ message: 'ID de denuncia inválido.' });
    }
    if (!tipo_denuncia || !titulo || !descripcion || !direccion_incidente || !comuna) {
        return res.status(400).json({ message: 'Todos los campos obligatorios de la denuncia (tipo, título, descripción, dirección, comuna) son requeridos para la actualización.' });
    }

    try {
        const result = await pool.query(
            `UPDATE Denuncia
             SET tipo_denuncia = $1, titulo = $2, descripcion = $3,
                 direccion_incidente = $4, comuna = $5,
                 id_denunciante = $6, id_denunciado = $7
             WHERE id_denuncia = $8
             RETURNING *`,
            [tipo_denuncia, titulo, descripcion, direccion_incidente, comuna, id_denunciante, id_denunciado, idDenuncia]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Denuncia no encontrada para actualizar.' });
        }

        res.status(200).json(result.rows[0]);

    } catch (error) {
        console.error(`Error al actualizar denuncia con ID ${idDenuncia}:`, error);
        if (error.code === '23503') {
            return res.status(400).json({ message: 'El ID de denunciante o denunciado proporcionado no existe.', details: error.detail });
        }
        res.status(500).json({ message: 'Error interno del servidor al actualizar la denuncia.' });
    }
};

// Eliminar una denuncia por ID
exports.deleteDenuncia = async (req, res) => {
    const idDenuncia = parseInt(req.params.id); // Obtiene el ID de la URL y lo convierte a entero

    // Validación básica del ID
    if (isNaN(idDenuncia)) {
        return res.status(400).json({ message: 'ID de denuncia inválido. Debe ser un número.' });
    }

    const client = await pool.connect(); // Obtener un cliente de la pool de conexiones para la transacción
    try {
        await client.query('BEGIN'); // Iniciar la transacción de base de datos

        console.log(`Backend: Iniciando eliminación en cascada para denuncia ID: ${idDenuncia}`);

        // 1. Eliminar registros en tablas "hijas" que referencian a la tabla DENUNCIA
        //    ¡EL ORDEN ES CRÍTICO! Elimina primero lo que depende de lo que vas a eliminar después.
        //    Asegúrate de incluir TODAS las tablas que tienen una clave foránea a 'Denuncia'.

        // Eliminar registros de la tabla 'Adjuntos' asociados a esta denuncia
        // Asumiendo que Adjuntos tiene una columna id_denuncia
        await client.query('DELETE FROM Adjuntos WHERE id_denuncia = $1', [idDenuncia]);
        console.log(`Backend: Adjuntos de denuncia ${idDenuncia} eliminados.`);

        // Eliminar registros de la tabla 'Informe_Inspeccion' asociados a esta denuncia
        // Asumiendo que Informe_Inspeccion tiene una columna id_denuncia
        await client.query('DELETE FROM Informe_Inspeccion WHERE id_denuncia = $1', [idDenuncia]);
        console.log(`Backend: Informes de inspección de denuncia ${idDenuncia} eliminados.`);

        // Eliminar registros de la tabla 'Comentario_Interno' asociados a esta denuncia
        // Asumiendo que Comentario_Interno tiene una columna id_denuncia
        await client.query('DELETE FROM Comentario_Interno WHERE id_denuncia = $1', [idDenuncia]);
        console.log(`Backend: Comentarios internos de denuncia ${idDenuncia} eliminados.`);

        // Eliminar registros de la tabla 'Avance_Denuncia' asociados a esta denuncia
        // Asumiendo que Avance_Denuncia tiene una columna id_denuncia
        await client.query('DELETE FROM Avance_Denuncia WHERE id_denuncia = $1', [idDenuncia]);
        console.log(`Backend: Avances de denuncia ${idDenuncia} eliminados.`);

        // Eliminar registros de la tabla 'Estado_Denuncia' asociados a esta denuncia
        // Asumiendo que Estado_Denuncia tiene una columna id_denuncia
        await client.query('DELETE FROM Estado_Denuncia WHERE id_denuncia = $1', [idDenuncia]);
        console.log(`Backend: Estados de denuncia ${idDenuncia} eliminados.`);

        // Eliminar registros de la tabla 'Asignacion_Denuncia' asociados a esta denuncia
        // Asumiendo que Asignacion_Denuncia tiene una columna id_denuncia
        await client.query('DELETE FROM Asignacion_Denuncia WHERE id_denuncia = $1', [idDenuncia]);
        console.log(`Backend: Asignaciones de denuncia ${idDenuncia} eliminadas.`);

        // 2. Finalmente, eliminar la denuncia principal de la tabla 'Denuncia'
        const result = await client.query('DELETE FROM Denuncia WHERE id_denuncia = $1 RETURNING id_denuncia', [idDenuncia]);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK'); // Si la denuncia no se encontró, revertir la transacción
            return res.status(404).json({ message: 'Denuncia no encontrada para eliminar.' });
        }

        await client.query('COMMIT'); // Confirmar todos los cambios si todo fue exitoso
        console.log(`Backend: Denuncia ${idDenuncia} y sus registros asociados eliminados exitosamente.`);
        res.status(200).json({ message: `Denuncia con ID ${idDenuncia} eliminada exitosamente.` });

    } catch (error) {
        await client.query('ROLLBACK'); // Revertir todos los cambios si ocurre algún error
        console.error('Backend: Error al eliminar la denuncia y sus asociaciones:', error);
        // Puedes intentar parsear el error de PostgreSQL para dar un mensaje más específico
        if (error.code === '23503') { // Código de error para violación de clave foránea en PostgreSQL
            res.status(409).json({ message: 'Conflicto: La denuncia no puede ser eliminada porque aún tiene registros asociados en una tabla no manejada. Por favor, contacta al administrador o verifica las dependencias.' });
        } else {
            res.status(500).json({ message: 'Error interno del servidor al eliminar la denuncia.' });
        }
    } finally {
        client.release(); // Liberar el cliente de la pool de conexiones
    }
};

// Asignar una denuncia a un inspector (Solo Director) 
exports.assignDenuncia = async (req, res) => {
    const { id } = req.params; // ID de la denuncia a asignar
    // CAMBIO: Usaremos 'id_responsable' en el body para coincidir con el nombre en la BD y facilitar la consulta del inspector.
    const { id_responsable, observaciones_asignacion } = req.body; // ID del inspector y observaciones

    // El ID del usuario que realiza la asignación (el Director)
    const id_director_asignador = req.user.id; // Asumimos que req.user.id contiene el ID del usuario DOM autenticado

    if (isNaN(id) || isNaN(id_responsable)) { // CAMBIO: Usamos id_responsable aquí
        return res.status(400).json({ message: 'IDs de denuncia o inspector inválidos.' });
    }

    try {
        // 1. Verificar que la denuncia existe y obtener su título para el correo
        const denunciaResult = await pool.query('SELECT id_denuncia, titulo, direccion_incidente, comuna FROM denuncia WHERE id_denuncia = $1', [id]);
        if (denunciaResult.rows.length === 0) {
            return res.status(404).json({ message: 'Denuncia no encontrada.' });
        }
        const denunciaInfo = denunciaResult.rows[0]; // Guarda la información de la denuncia

        // 2. Verificar que el id_responsable es un usuario válido con rol de 'inspector'
        // Y obtener su email y nombre para el correo
        const inspectorInfoResult = await pool.query(
            `SELECT id_usuario, email, nombre_usuario, p_apellido_usuario 
             FROM usuarios 
             WHERE id_usuario = $1 AND rol = 'inspector'`,
            [id_responsable] // CAMBIO: Usamos id_responsable aquí
        );
        if (inspectorInfoResult.rows.length === 0) {
            return res.status(400).json({ message: 'El ID proporcionado no corresponde a un inspector válido.' });
        }
        const inspectorInfo = inspectorInfoResult.rows[0]; // Guarda la información del inspector

        // 3. Insertar la asignación en la tabla ASIGNACION_DENUNCIA
        const asignacionResult = await pool.query(
            `INSERT INTO asignacion_denuncia (
                id_denuncia,
                id_responsable, -- Este es el inspector asignado
                fecha_asignacion,
                observaciones_asignacion
            ) VALUES ($1, $2, NOW(), $3)
            RETURNING *`,
            [id, id_responsable, observaciones_asignacion]
        );

        // 4. Actualizar el estado de la denuncia a "Asignada" en la tabla ESTADO_DENUNCIA
        const estadoResult = await pool.query(
            `INSERT INTO estado_denuncia (
                id_denuncia,
                estado,
                fecha_ultima_actualizacion,
                id_responsable -- Este es el director que asigna
            ) VALUES ($1, $2, NOW(), $3)
            RETURNING *`,
            [id, 'Asignada', id_director_asignador]
        );

        // CÓDIGO DE NOTIFICACIÓN POR EMAIL 
        try {
            const inspectorEmail = inspectorInfo.email;
            const inspectorName = `${inspectorInfo.nombre_usuario} ${inspectorInfo.p_apellido_usuario}`;
            const subject = `Nueva Denuncia Asignada: #${denunciaInfo.id_denuncia}`;
            const htmlContent = `
                <p>Estimado/a ${inspectorName},</p>
                <p>Se le ha asignado una nueva denuncia para su gestión:</p>
                <ul>
                    <li><strong>ID de Denuncia:</strong> #${denunciaInfo.id_denuncia}</li>
                    <li><strong>Título:</strong> ${denunciaInfo.titulo}</li>
                    <li><strong>Dirección:</strong> ${denunciaInfo.direccion_incidente}, ${denunciaInfo.comuna}</li>
                </ul>
                <p>Por favor, acceda a la plataforma para revisar los detalles.</p>
                <p>Saludos cordiales,<br>Plataforma de Denuncias DOM</p>
            `;
            await sendEmail(inspectorEmail, subject, htmlContent);
            console.log(`Notificación enviada al inspector ${inspectorEmail} para la denuncia #${denunciaInfo.id_denuncia}`);
        } catch (emailError) {
            console.error('Error al enviar correo al inspector asignado:', emailError);
            // No se detiene la respuesta principal si falla el envío de correo, solo se loguea el error.
        }
        
        res.status(200).json({
            message: 'Denuncia asignada exitosamente y estado actualizado.',
            asignacion: asignacionResult.rows[0],
            estado: estadoResult.rows[0]
        });

    } catch (error) {
        console.error(`Error al asignar denuncia ${id}:`, error);
        res.status(500).json({ message: 'Error interno del servidor al asignar la denuncia.' });
    }
};

// Actualizar el estado de una denuncia (Director de Obras e Inspector)
exports.updateDenunciaState = async (req, res) => {
    const { id } = req.params; // ID de la denuncia
    const { estado } = req.body; // El nuevo estado de la denuncia

    // El ID del usuario que realiza la actualización (Inspector o Director)
    const id_usuario_actualizador = req.user.id; 

    if (isNaN(id)) {
        return res.status(400).json({ message: 'ID de denuncia inválido.' });
    }
    if (!estado || typeof estado !== 'string' || estado.trim() === '') {
        return res.status(400).json({ message: 'El nuevo estado de la denuncia es requerido y debe ser una cadena de texto no vacía.' });
    }

    try {
        // 1. Verificar que la denuncia existe
        const denunciaExists = await pool.query('SELECT id_denuncia FROM denuncia WHERE id_denuncia = $1', [id]);
        if (denunciaExists.rows.length === 0) {
            return res.status(404).json({ message: 'Denuncia no encontrada.' });
        }

        // 2. Insertar el nuevo estado en la tabla ESTADO_DENUNCIA
        const estadoResult = await pool.query(
            `INSERT INTO estado_denuncia (
                id_denuncia,
                estado,
                fecha_ultima_actualizacion,
                id_responsable
            ) VALUES ($1, $2, NOW(), $3)
            RETURNING *`,
            [id, estado, id_usuario_actualizador]
        );

        res.status(200).json({
            message: `Estado de la denuncia ${id} actualizado a '${estado}' exitosamente.`,
            estado_registrado: estadoResult.rows[0]
        });

    } catch (error) {
        console.error(`Error al actualizar el estado de la denuncia ${id}:`, error);
        res.status(500).json({ message: 'Error interno del servidor al actualizar el estado de la denuncia.' });
    }
};

// Eliminar un adjunto de una denuncia (Director de Obras e Inspector)
exports.deleteAdjunto = async (req, res) => {
    const { id: id_denuncia, id_adjunto } = req.params;

    if (isNaN(id_denuncia) || isNaN(id_adjunto)) {
        return res.status(400).json({ message: 'IDs de denuncia o adjunto inválidos.' });
    }

    try {
        // 1. Verificar que la denuncia existe
        const denunciaExists = await pool.query('SELECT id_denuncia FROM Denuncia WHERE id_denuncia = $1', [id_denuncia]);
        if (denunciaExists.rows.length === 0) {
            return res.status(404).json({ message: 'Denuncia no encontrada.' });
        }

        // 2. Verificar que el adjunto existe y pertenece a la denuncia especificada
        const adjuntoResult = await pool.query(
            'SELECT id_adjunto, ruta_almacenamiento FROM Adjuntos WHERE id_adjunto = $1 AND id_denuncia = $2',
            [`${id_adjunto}`, `${id_denuncia}`]
        );

        if (adjuntoResult.rows.length === 0) {
            return res.status(404).json({ message: 'Adjunto no encontrado o no pertenece a esta denuncia.' });
        }

        const adjunto = adjuntoResult.rows [0];
        const ruta_almacenamiento = adjunto.ruta_almacenamiento;

        // 3. Eliminar el registro del adjunto de la base de datos
        await pool.query('DELETE FROM Adjuntos WHERE id_adjunto = $1', [`${id_adjunto}`]);

        // 4. Eliminar el archivo del sistema de archivos 
        // Esto requiere la librería 'fs' de Node.js
        const fs = require('fs').promises;
        try {
            await fs.unlink(ruta_almacenamiento);
            console.log(`Archivo eliminado: ${ruta_almacenamiento}`);
        } catch (error) {
            console.error(`Error al eliminar el archivo ${ruta_almacenamiento}:`, error);
            // No detenemos la respuesta si falla la eliminación del archivo (podría ser un archivo ya borrado o un problema de permisos)
        }


        res.status(200).json({ message: `Adjunto con ID ${id_adjunto} de la denuncia ${id_denuncia} eliminado exitosamente.` });

    } catch (error) {
        console.error(`Error al eliminar el adjunto ${id_adjunto} de la denuncia ${id_denuncia}:`, error);
        res.status(500).json({ message: 'Error interno del servidor al eliminar el adjunto.' });
    }
};

// Obtener reporte de conteo de denuncias por estado, tipo, tiempo promedio de resolución y denuncias por inspector ---
exports.getDenunciaReport = async (req, res) => {
    try {
        // Conteo de denuncias por estado actual
        const countByStateResult = await pool.query(
            `WITH LastState AS (
                SELECT
                    id_denuncia,
                    estado,
                    ROW_NUMBER() OVER (PARTITION BY id_denuncia ORDER BY fecha_ultima_actualizacion DESC) as rn
                FROM Estado_Denuncia
            )
            SELECT
                ls.estado,
                COUNT(d.id_denuncia) AS total_denuncias
            FROM Denuncia d
            JOIN LastState ls ON d.id_denuncia = ls.id_denuncia
            WHERE ls.rn = 1
            GROUP BY ls.estado
            ORDER BY ls.estado;
            `
        );

        // Conteo de denuncias por tipo de denuncia
        const countByTypeResult = await pool.query(
            `SELECT
                tipo_denuncia,
                COUNT(id_denuncia) AS total_denuncias
            FROM Denuncia
            GROUP BY tipo_denuncia
            ORDER BY tipo_denuncia;
            `
        );

        // Calcular el tiempo promedio de resolución
        const avgResolutionTimeResult = await pool.query(
            `WITH DenunciaCreation AS (
                SELECT
                    id_denuncia,
                    fecha_ingreso -- Usando 'fecha_ingreso' como la fecha de creación
                FROM Denuncia
            ),
            DenunciaResolved AS (
                SELECT
                    id_denuncia,
                    fecha_ultima_actualizacion AS fecha_resolucion,
                    ROW_NUMBER() OVER (PARTITION BY id_denuncia ORDER BY fecha_ultima_actualizacion DESC) as rn
                FROM Estado_Denuncia
                WHERE estado = 'Resuelta' -- ¡Ajusta si el estado final es diferente!
            )
            SELECT
                ROUND(AVG(EXTRACT(EPOCH FROM (dr.fecha_resolucion - dc.fecha_ingreso)) / (60 * 60 * 24))::numeric, 2) AS promedio_dias_resolucion
            FROM DenunciaCreation dc
            JOIN DenunciaResolved dr ON dc.id_denuncia = dr.id_denuncia
            WHERE dr.rn = 1;
            `
        );

        // Conteo de denuncias por inspector asignado
        const countByInspectorResult = await pool.query(
            `WITH LastAssignment AS (
                SELECT
                    id_denuncia,
                    id_responsable,
                    ROW_NUMBER() OVER (PARTITION BY id_denuncia ORDER BY fecha_asignacion DESC) as rn
                FROM Asignacion_Denuncia
            )
            SELECT
                u.nombre_usuario || ' ' || u.p_apellido_usuario AS nombre_inspector,
                COUNT(la.id_denuncia) AS total_denuncias_asignadas
            FROM LastAssignment la
            JOIN usuarios u ON la.id_responsable = u.id_usuario
            WHERE la.rn = 1 AND u.rol = 'inspector'
            GROUP BY u.nombre_usuario, u.p_apellido_usuario
            ORDER BY total_denuncias_asignadas DESC;
            `
        );

        res.status(200).json({
            conteo_por_estado: countByStateResult.rows,
            conteo_por_tipo: countByTypeResult.rows,
            promedio_tiempo_resolucion_dias: avgResolutionTimeResult.rows[0].promedio_dias_resolucion,
            // Conteo de denuncias por inspector
            conteo_por_inspector: countByInspectorResult.rows
        });

    } catch (error) {
        console.error('Error al generar el reporte de denuncias:', error);
        res.status(500).json({ message: 'Error interno del servidor al generar el reporte.' });
    }
};

// Función para Consulta de Estado de Denuncia (PÚBLICA) ---
exports.getDenunciaStatusByPublicId = async (req, res) => {
    const { id } = req.params;
    const publicId = id; 

    console.log(`[DEBUG Backend] Public ID recibido en la ruta: ${publicId}`);

    try {
        const result = await pool.query(
            `SELECT
                d.public_id,
                d.titulo,
                d.descripcion,
                d.fecha_ingreso,
                ed.estado AS estado_actual, -- Asumiendo que la columna en estado_denuncia se llama 'estado'
                ed.fecha_ultima_actualizacion AS fecha_estado_actual
             FROM Denuncia d
             JOIN estado_denuncia ed ON d."id_denuncia" = ed."id_denuncia" 
             WHERE d.public_id = $1
             ORDER BY ed.fecha_ultima_actualizacion DESC
             LIMIT 1;`,
            [publicId]
        );

        console.log(`[DEBUG Backend] Resultados de la consulta SQL: ${JSON.stringify(result.rows)}`);

        if (result.rows.length === 0) {
            console.log(`[DEBUG Backend] Denuncia con public_id ${publicId} NO encontrada.`);
            return res.status(404).json({ message: 'No se encontró una denuncia con ese ID público.' });
        }

        const denuncia = result.rows[0];
        console.log(`[DEBUG Backend] Denuncia encontrada: ${JSON.stringify(denuncia)}`);

        res.status(200).json({
            public_id: denuncia.public_id,
            titulo: denuncia.titulo,
            descripcion: denuncia.descripcion,
            estado_actual: denuncia.estado_actual,
            fecha_ingreso: denuncia.fecha_ingreso,
            fecha_estado_actual: denuncia.fecha_estado_actual
        });

    } catch (error) {
        console.error(`[DEBUG Backend] Error en la consulta de denuncia pública con ID ${publicId}:`, error);
        if (error.code) {
            console.error(`[DEBUG Backend] Código de error DB: ${error.code}`);
            console.error(`[DEBUG Backend] Hint DB: ${error.hint}`);
        }
        res.status(500).json({ message: 'Error interno del servidor al consultar el estado de la denuncia.' });
    }
};

// Nueva función para agregar un avance (comentario) y adjuntos a una denuncia
exports.addDenunciaAdvanceAndAttachments = async (req, res) => {
    const { id } = req.params; // ID de la denuncia
    const { comentario } = req.body; // Comentario o descripción del avance

    // Asegurarse de que el usuario sea un inspector o director
    if (!req.user || (req.user.rol !== 'inspector' && req.user.rol !== 'director_de_obras')) {
        return res.status(403).json({ message: 'Acceso denegado. Solo inspectores o directores pueden registrar avances.' });
    }

    const id_inspector_o_director = req.user.id; // El ID del usuario que registra el avance
    const files = req.files; // Archivos subidos por Multer

    if (isNaN(id)) {
        return res.status(400).json({ message: 'ID de denuncia inválido.' });
    }
    if (!comentario && (!files || files.length === 0)) {
        return res.status(400).json({ message: 'Se requiere un comentario o al menos un archivo adjunto para registrar un avance.' });
    }

    const client = await pool.connect(); // Iniciar transacción
    try {
        await client.query('BEGIN');

        // 1. Verificar que la denuncia existe
        const denunciaExists = await client.query('SELECT id_denuncia FROM Denuncia WHERE id_denuncia = $1', [id]);
        if (denunciaExists.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Denuncia no encontrada.' });
        }

        // 2. Insertar el avance/comentario en una nueva tabla o en Estado_Denuncia
        // Opción 1 a futuro si queremos una tabla separada para "Avances" (más detallado)
        // CREATE TABLE Avance_Denuncia (
        //     id_avance SERIAL PRIMARY KEY,
        //     id_denuncia INT NOT NULL REFERENCES Denuncia(id_denuncia),
        //     comentario TEXT NOT NULL,
        //     fecha_avance TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        //     id_usuario_responsable INT REFERENCES Usuarios(id_usuario)
        // );
        let id_avance_registrado = null;
        if (comentario) {
            const avanceResult = await client.query(
                `INSERT INTO Avance_Denuncia (id_denuncia, comentario, fecha_avance, id_usuario_responsable)
                 VALUES ($1, $2, NOW(), $3) RETURNING id_avance`,
                [id, comentario, id_inspector_o_director]
            );
            id_avance_registrado = avanceResult.rows[0].id_avance;
        }

        // Opción 2 a futuro si queremos insertar el comentario como un nuevo estado 'Comentario Agregado' en Estado_Denuncia
        // Esto sería menos granular pero más simple si no necesitas una tabla de avances
        // await client.query(
        //     'INSERT INTO ESTADO_DENUNCIA (id_denuncia, estado, fecha_ultima_actualizacion, id_responsable) VALUES ($1, $2, NOW(), $3)',
        //     [id, `Comentario: ${comentario.substring(0, 90)}...`, id_inspector_o_director]
        // );


        // 3. Insertar los adjuntos si existen
        const adjuntosGuardados = [];
        if (files && files.length > 0) {
            for (const file of files) {
                const { originalname, mimetype, path: filePath } = file;
                const insertAdjuntoResult = await client.query(
                    `INSERT INTO Adjuntos (
                        id_denuncia,
                        nombre_archivo,
                        tipo_archivo,
                        ruta_almacenamiento,
                        fecha_carga,
                        descripcion,
                        id_usuario_carga,
                        id_avance_asociado -- ¡Nueva columna opcional en la tabla Adjuntos!
                    ) VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7) RETURNING *`,
                    [
                        id,
                        originalname,
                        mimetype,
                        filePath,
                        comentario, // Usar el comentario del avance como descripción del adjunto
                        id_inspector_o_director,
                        id_avance_registrado // Vincular al ID del avance si existe
                    ]
                );
                adjuntosGuardados.push(insertAdjuntoResult.rows[0]);
            }
        }

        await client.query('COMMIT'); // Confirmar la transacción

        res.status(201).json({
            message: 'Avance de denuncia y/o adjuntos registrados exitosamente.',
            id_denuncia: id,
            id_avance: id_avance_registrado,
            adjuntos_cargados: adjuntosGuardados.map(adj => ({ id: adj.id_adjunto, nombre: adj.nombre_archivo }))
        });

    } catch (error) {
        await client.query('ROLLBACK'); // Revertir en caso de error
        console.error(`Error al registrar avance/adjuntos para denuncia ${id}:`, error);
        // Si hay archivos ya subidos localmente, intentar eliminarlos en caso de error de BD
        if (files && files.length > 0) {
            const fs = require('fs').promises;
            for (const file of files) {
                try {
                    await fs.unlink(file.path);
                    console.log(`Archivo temporal eliminado tras error de BD: ${file.path}`);
                } catch (unlinkError) {
                    console.error(`Error al eliminar archivo temporal ${file.path}:`, unlinkError);
                }
            }
        }
        res.status(500).json({ message: 'Error interno del servidor al registrar el avance/adjuntos.' });
    } finally {
        client.release(); // Liberar el cliente
    }
};

// Función para obtener el historial de avances
exports.getDenunciaAdvances = async (req, res) => {
    const { id } = req.params;

    if (isNaN(id)) {
        return res.status(400).json({ message: 'ID de denuncia inválido.' });
    }

    try {
        const advancesResult = await pool.query(
            `SELECT
                ad.id_avance,
                ad.comentario,
                ad.fecha_avance,
                u.nombre_usuario,
                u.p_apellido_usuario,
                u.s_apellido_usuario
            FROM Avance_Denuncia ad
            JOIN Usuarios u ON ad.id_usuario_responsable = u.id_usuario
            WHERE ad.id_denuncia = $1
            ORDER BY ad.fecha_avance ASC`,
            [id]
        );

        // Opcional: Obtener adjuntos asociados a cada avance
        const advancesWithAttachments = await Promise.all(advancesResult.rows.map(async (advance) => {
            const attachmentsResult = await pool.query(
                `SELECT id_adjunto, nombre_archivo, tipo_archivo, ruta_almacenamiento, fecha_carga
                 FROM Adjuntos
                 WHERE id_avance_asociado = $1
                 ORDER BY fecha_carga ASC`,
                [advance.id_avance]
            );
            return {
                ...advance,
                nombre_usuario_responsable: `${advance.nombre_usuario} ${advance.p_apellido_usuario} ${advance.s_apellido_usuario}`,
                adjuntos: attachmentsResult.rows
            };
        }));

        res.status(200).json(advancesWithAttachments);

    } catch (error) {
        console.error(`Error al obtener avances de la denuncia ${id}:`, error);
        res.status(500).json({ message: 'Error interno del servidor al obtener los avances.' });
    }
};

