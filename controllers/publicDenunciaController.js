// controllers/publicDenunciaController.js
const pool = require('../config/db');
const { sendEmail } = require('../utils/mailer'); // Si deseas enviar un correo de confirmación al denunciante

// Función para que un usuario externo cree una nueva denuncia
exports.createPublicDenuncia = async (req, res) => {
    // Los campos de la denuncia vendrán directamente del cuerpo de la solicitud
    const {
        tipo_denuncia,
        titulo,
        descripcion,
        direccion_incidente,
        comuna,
        nombre_denunciante, // Para crear el registro en la tabla Denunciante si no existe
        p_apellido_denunciante,
        s_apellido_denunciante,
        email_denunciante,
        telefono_denunciante,
        id_contribuyente_asociado, // Opcional: si la denuncia la hace un contribuyente logueado
        id_denunciado // Opcional: ID del contribuyente denunciado
    } = req.body;

    // Validación básica
    if (!tipo_denuncia || !titulo || !descripcion || !direccion_incidente || !comuna || !email_denunciante) {
        return res.status(400).json({ message: 'Los campos tipo_denuncia, titulo, descripcion, direccion_incidente, comuna y email_denunciante son obligatorios.' });
    }

    const client = await pool.connect(); // Usar una transacción para asegurar atomicidad
    try {
        await client.query('BEGIN');

        let id_denunciante_final = null;

        // 1. Manejar el Denunciante: Buscar o Crear
        // Primero intentamos buscar un Denunciante por el email proporcionado
        const existingDenunciante = await client.query(
            'SELECT id_denunciante, id_contribuyente FROM Denunciante WHERE email_denunciante = $1',
            [email_denunciante]
        );

        if (existingDenunciante.rows.length > 0) {
            // Si el denunciante ya existe por email
            id_denunciante_final = existingDenunciante.rows[0].id_denunciante;
            // Opcional: Actualizar datos si han cambiado, aunque para denuncias públicas usualmente se toma el existente.
            // Si el cliente envía id_contribuyente_asociado y el existente no lo tiene, se puede asociar aquí.
            if (!existingDenunciante.rows[0].id_contribuyente && id_contribuyente_asociado) {
                 await client.query(
                    'UPDATE Denunciante SET id_contribuyente = $1 WHERE id_denunciante = $2',
                    [id_contribuyente_asociado, id_denunciante_final]
                );
            }
        } else {
            // Si el denunciante no existe, crearlo
            const newDenuncianteResult = await client.query(
                `INSERT INTO Denunciante (
                    nombre_denunciante,
                    p_apellido_denunciante,
                    s_apellido_denunciante,
                    email_denunciante,
                    telefono_denunciante,
                    id_contribuyente
                ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_denunciante`,
                [
                    nombre_denunciante || 'Anónimo', // Usar 'Anónimo' si no se proporciona
                    p_apellido_denunciante || null,
                    s_apellido_denunciante || null,
                    email_denunciante,
                    telefono_denunciante || null,
                    id_contribuyente_asociado || null // Vincular si se proporcionó un ID de contribuyente
                ]
            );
            id_denunciante_final = newDenuncianteResult.rows[0].id_denunciante;
        }

        // 2. Insertar la denuncia principal
        const denunciaResult = await client.query(
            'INSERT INTO Denuncia (tipo_denuncia, titulo, descripcion, direccion_incidente, comuna, fecha_ingreso, id_denunciante, id_denunciado, public_id) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, (SELECT floor(random() * 900000000 + 100000000)::bigint)) RETURNING id_denuncia, public_id', // Generar un public_id numérico de 9 dígitos
            [tipo_denuncia, titulo, descripcion, direccion_incidente, comuna, id_denunciante_final, id_denunciado]
        );
        const newDenunciaId = denunciaResult.rows[0].id_denuncia;
        const newPublicId = denunciaResult.rows[0].public_id; // Recuperar el public_id generado

        // 3. Insertar el estado inicial en ESTADO_DENUNCIA
        const estadoInicial = 'Registrada sin asignar'; // Estado por defecto para denuncias externas
        const id_responsable_estado = null; // No hay un usuario DOM que cree esta denuncia, por lo tanto, null.
                                          // Esto requiere que id_responsable en ESTADO_DENUNCIA sea NULLABLE.

        await client.query(
            'INSERT INTO ESTADO_DENUNCIA (id_denuncia, estado, fecha_ultima_actualizacion, id_responsable) VALUES ($1, $2, NOW(), $3)',
            [newDenunciaId, estadoInicial, id_responsable_estado]
        );

        await client.query('COMMIT'); // Confirmar la transacción

        // CÓDIGO DE NOTIFICACIÓN POR EMAIL (OPCIONAL)
        try {
            const subject = `Confirmación de Recepción de Denuncia #${newPublicId}`;
            const htmlContent = `
                <p>Estimado/a ${nombre_denunciante || email_denunciante},</p>
                <p>Hemos recibido su denuncia con éxito.</p>
                <p>Detalles de su denuncia:</p>
                <ul>
                    <li><strong>ID de Seguimiento:</strong> **#${newPublicId}**</li>
                    <li><strong>Título:</strong> ${titulo}</li>
                    <li><strong>Dirección del Incidente:</strong> ${direccion_incidente}, ${comuna}</li>
                    <li><strong>Fecha de Ingreso:</strong> ${new Date().toLocaleDateString('es-CL')}</li>
                    <li><strong>Estado Inicial:</strong> ${estadoInicial}</li>
                </ul>
                <p>Puede hacer seguimiento al estado de su denuncia utilizando el ID de seguimiento **#${newPublicId}** en nuestra plataforma.</p>
                <p>Saludos cordiales,<br>Dirección de Obras Municipales</p>
            `;
            await sendEmail(email_denunciante, subject, htmlContent);
            console.log(`Correo de confirmación enviado a ${email_denunciante} para denuncia #${newPublicId}`);
        } catch (emailError) {
            console.error('Error al enviar correo de confirmación al denunciante:', emailError);
            // No detenemos la respuesta principal si falla el envío de correo.
        }

        res.status(201).json({
            message: 'Denuncia creada exitosamente. Se ha enviado un correo de confirmación.',
            denuncia: {
                id_denuncia: newDenunciaId,
                public_id: newPublicId, // Incluir el ID público para que el frontend lo muestre
                estado_inicial: estadoInicial
            }
        });

    } catch (error) {
        await client.query('ROLLBACK'); // Revertir la transacción en caso de error
        console.error('Error al crear denuncia pública:', error);
        if (error.code === '23503') { // Foreign Key Violation (ej. id_denunciado no existe)
            return res.status(400).json({ message: 'Uno de los IDs (denunciante o denunciado) proporcionados no es válido o hay un problema con la vinculación.', details: error.detail });
        }
        res.status(500).json({ message: 'Error interno del servidor al procesar la denuncia.' });
    } finally {
        client.release(); // Liberar el cliente de la pool
    }
};

// Modificación a getDenunciaStatusByPublicId para usar el pool.query directamente
// (Esto es solo una sugerencia si quieres mover esta función aquí)
// exports.getDenunciaStatusByPublicId = async (req, res) => {
//     const { id } = req.params; // Este es el public_id, no el id_denuncia interno

//     // Validar que el ID es un número (ya que generamos public_id como bigint)
//     if (isNaN(id) || id.length !== 9) { // Asumiendo que public_id es un número de 9 dígitos
//         return res.status(400).json({ message: 'ID de seguimiento de denuncia inválido.' });
//     }

//     try {
//         const result = await pool.query(
//             `SELECT
//                 d.id_denuncia,
//                 d.titulo,
//                 d.descripcion,
//                 d.fecha_ingreso,
//                 ed.estado AS estado_actual,
//                 ed.fecha_ultima_actualizacion AS fecha_estado_actual
//             FROM Denuncia d
//             JOIN Estado_Denuncia ed ON d.id_denuncia = ed.id_denuncia
//             WHERE d.public_id = $1
//             ORDER BY ed.fecha_ultima_actualizacion DESC
//             LIMIT 1`,
//             [id]
//         );

//         if (result.rows.length === 0) {
//             return res.status(404).json({ message: 'Denuncia no encontrada con ese ID de seguimiento.' });
//         }

//         res.status(200).json(result.rows[0]);

//     } catch (error) {
//         console.error(`Error al obtener estado de denuncia pública con ID ${id}:`, error);
//         res.status(500).json({ message: 'Error interno del servidor al obtener el estado de la denuncia.' });
//     }
// };