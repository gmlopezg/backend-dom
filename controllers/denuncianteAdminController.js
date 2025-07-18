const pool = require('../config/db');

// Obtener todos los denunciantes (Solo Administrador DOM)
exports.getAllDenunciantes = async (req, res) => {
    try {
        const query = `
            SELECT 
                d.id_denunciante, 
                d.nombre_denunciante, 
                d.p_apellido_denunciante, 
                d.s_apellido_denunciante, 
                d.email_denunciante, 
                d.telefono_denunciante, 
                d.id_contribuyente,
                c.email_contribuyente AS email_cuenta_contribuyente -- Opcional: mostrar el email de la cuenta de contribuyente vinculada
            FROM Denunciante d
            LEFT JOIN Contribuyente c ON d.id_contribuyente = c.id_contribuyente
            ORDER BY d.nombre_denunciante ASC, d.p_apellido_denunciante ASC;
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error al obtener todos los denunciantes (Admin):', error);
        res.status(500).json({ message: 'Error interno del servidor al obtener denunciantes.' });
    }
};

// Obtener un denunciante por ID (Solo Administrador DOM)
exports.getDenuncianteById = async (req, res) => {
    const { id } = req.params;

    if (isNaN(id)) {
        return res.status(400).json({ message: 'ID de denunciante inválido.' });
    }

    try {
        const query = `
            SELECT 
                d.id_denunciante, 
                d.nombre_denunciante, 
                d.p_apellido_denunciante, 
                d.s_apellido_denunciante, 
                d.email_denunciante, 
                d.telefono_denunciante, 
                d.id_contribuyente,
                c.email_contribuyente AS email_cuenta_contribuyente
            FROM Denunciante d
            LEFT JOIN Contribuyente c ON d.id_contribuyente = c.id_contribuyente
            WHERE d.id_denunciante = $1;
        `;
        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Denunciante no encontrado.' });
        }
        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error(`Error al obtener denunciante con ID ${id} (Admin):`, error);
        res.status(500).json({ message: 'Error interno del servidor al obtener el denunciante.' });
    }
};

// Actualizar un denunciante por ID (Solo Administrador DOM)
exports.updateDenunciante = async (req, res) => {
    console.log('*** INICIO DE FUNCIÓN updateDenunciante ***');
    console.log('ID del denunciante (req.params.id):', req.params.id);
    console.log('Cuerpo de la petición (req.body):', req.body);

    const { id } = req.params;
    const { rut_denunciante, nombre_denunciante, p_apellido_denunciante, s_apellido_denunciante, email_denunciante, telefono_denunciante } = req.body;

    if (isNaN(id)) {
        return res.status(400).json({ message: 'ID de denunciante inválido.' });
    }

    const client = await pool.connect(); // Iniciar una transacción
    try {
        await client.query('BEGIN'); // Iniciar la transacción
        console.log('Transacción iniciada.');

        // 1. Obtener el denunciante actual y su posible id_contribuyente
        const currentDenuncianteResult = await client.query('SELECT id_denunciante, email_denunciante, id_contribuyente FROM Denunciante WHERE id_denunciante = $1 FOR UPDATE', [id]);
        if (currentDenuncianteResult.rows.length === 0) {
            await client.query('ROLLBACK');
            console.log('ROLLBACK: Denunciante no encontrado.');
            return res.status(404).json({ message: 'Denunciante no encontrado.' });
        }
        const currentDenunciante = currentDenuncianteResult.rows[0];
        console.log('Denunciante actual obtenido:', currentDenunciante);

        // 2. Construir la consulta de actualización para Denunciante
        const fields = [];
        const values = [];
        let queryIndex = 1;

        if (rut_denunciante !== undefined) {
            fields.push(`rut_denunciante = $${queryIndex++}`);
            values.push(rut_denunciante);
        }
        if (nombre_denunciante !== undefined) {
            fields.push(`nombre_denunciante = $${queryIndex++}`);
            values.push(nombre_denunciante);
        }
        if (p_apellido_denunciante !== undefined) {
            fields.push(`p_apellido_denunciante = $${queryIndex++}`);
            values.push(p_apellido_denunciante);
        }
        if (s_apellido_denunciante !== undefined) {
            fields.push(`s_apellido_denunciante = $${queryIndex++}`);
            values.push(s_apellido_denunciante);
        }
        if (telefono_denunciante !== undefined) {
            fields.push(`telefono_denunciante = $${queryIndex++}`);
            values.push(telefono_denunciante);
        }

        // Lógica especial para email_denunciante (si se proporciona y es diferente)
        console.log('Procesando email_denunciante...');
        console.log('email_denunciante del body:', email_denunciante);
        console.log('currentDenunciante.email_denunciante:', currentDenunciante.email_denunciante);

        if (email_denunciante !== undefined && email_denunciante !== currentDenunciante.email_denunciante) {
            console.log('Email de denunciante ha cambiado. Procediendo a actualizar.');
            // Verificar si el nuevo email ya está en uso por OTRO denunciante
            const existingDenuncianteEmail = await client.query('SELECT id_denunciante FROM Denunciante WHERE email_denunciante = $1 AND id_denunciante != $2', [email_denunciante, id]);
            if (existingDenuncianteEmail.rows.length > 0) {
                await client.query('ROLLBACK');
                console.log('ROLLBACK: Nuevo email de denunciante ya existe para otro denunciante.');
                return res.status(409).json({ message: 'El nuevo email de denunciante ya está registrado por otro denunciante.' });
            }
            console.log('Email de denunciante no en conflicto con otros denunciantes.');

            fields.push(`email_denunciante = $${queryIndex++}`);
            values.push(email_denunciante);

            // Si el denunciante está vinculado a una cuenta de contribuyente,
            // y el email ha cambiado, también actualizar el email del contribuyente
            if (currentDenunciante.id_contribuyente) {
                console.log(`Denunciante vinculado a Contribuyente ID: ${currentDenunciante.id_contribuyente}. Intentando actualizar email de Contribuyente.`);

                // Verificar si el nuevo email ya está en uso por OTRO contribuyente
                const existingContribuyenteEmail = await client.query('SELECT id_contribuyente FROM Contribuyente WHERE email_contribuyente = $1 AND id_contribuyente != $2', [email_denunciante, currentDenunciante.id_contribuyente]);
                if (existingContribuyenteEmail.rows.length > 0) {
                    await client.query('ROLLBACK');
                    console.log('ROLLBACK: Nuevo email de contribuyente ya está en uso por otra cuenta de contribuyente.');
                    return res.status(409).json({ message: 'El nuevo email ya está en uso por otra cuenta de contribuyente.' });
                }

                await client.query(
                    'UPDATE Contribuyente SET email_contribuyente = $1 WHERE id_contribuyente = $2',
                    [email_denunciante, currentDenunciante.id_contribuyente]
                );
                console.log(`¡ÉXITO! Email de Contribuyente ${currentDenunciante.id_contribuyente} actualizado a ${email_denunciante}.`);
            } else {
                console.log('Denunciante NO vinculado a ninguna cuenta de Contribuyente. No se actualiza el email del Contribuyente.');
            }
        } else if (email_denunciante !== undefined && email_denunciante === currentDenunciante.email_denunciante) {
            console.log('Email de denunciante enviado es el mismo que el actual. No se requiere actualización de email.');
        } else {
            console.log('Email de denunciante no proporcionado en el body.');
        }


        if (fields.length === 0) {
            await client.query('ROLLBACK');
            console.log('ROLLBACK: No se proporcionaron campos para actualizar en el denunciante.');
            return res.status(400).json({ message: 'No se proporcionaron campos para actualizar en el denunciante.' });
        }

        values.push(id); // El ID del denunciante es el último valor para la cláusula WHERE
        const updateDenuncianteQuery = `UPDATE Denunciante SET ${fields.join(', ')} WHERE id_denunciante = $${queryIndex} RETURNING *`;

        const result = await client.query(updateDenuncianteQuery, values);
        await client.query('COMMIT'); // Confirmar la transacción
        console.log('Transacción confirmada (COMMIT).');

        res.status(200).json({ message: 'Denunciante y (si aplica) Contribuyente actualizados exitosamente.', denunciante: result.rows[0] });

    } catch (error) {
        await client.query('ROLLBACK'); // Revertir la transacción en caso de error
        console.error(`¡ERROR CRÍTICO! Error al actualizar denunciante con ID ${id} (Admin):`, error);
        res.status(500).json({ message: 'Error interno del servidor al actualizar el denunciante.' });
    } finally {
        client.release(); // Liberar el cliente de la pool
        console.log('Cliente de la base de datos liberado.');
    }
};

// No se incluye delete Denunciante aquí directamente, ya que un denunciante está vinculado a denuncias.
// La eliminación de un denunciante suele requerir más lógica de negocio para manejar las denuncias asociadas.