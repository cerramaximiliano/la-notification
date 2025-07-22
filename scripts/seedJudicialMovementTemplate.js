const mongoose = require('mongoose');
const dotenv = require('dotenv');
const retrieveSecrets = require('../config/env');
const fs = require('fs/promises');
const path = require('path');

// Importar modelos
const { EmailTemplate } = require('../models');
const templateData = require('../templates/judicial-movement-template');

async function seedTemplate() {
  try {
    // Cargar variables de entorno
    const secretsString = await retrieveSecrets();
    await fs.writeFile(path.join(__dirname, '..', '.env'), secretsString);
    dotenv.config({ path: path.join(__dirname, '..', '.env') });
    
    // Conectar a MongoDB usando URLDB
    const mongoUri = process.env.URLDB;
    
    if (!mongoUri) {
      console.log('URLDB no está definida en las variables de entorno');
      return;
    }
    
    await mongoose.connect(mongoUri);
    
    console.log('Conectado a MongoDB');

    // Buscar si ya existe el template
    const existingTemplate = await EmailTemplate.findOne({
      category: templateData.category,
      name: templateData.name
    });

    if (existingTemplate) {
      console.log('Template ya existe, actualizando...');
      
      // Actualizar template existente
      Object.assign(existingTemplate, {
        subject: templateData.subject,
        preheader: templateData.preheader,
        htmlContent: templateData.htmlContent,
        textContent: templateData.textContent,
        description: templateData.description,
        variables: templateData.variables,
        tags: templateData.tags,
        metadata: {
          ...existingTemplate.metadata,
          ...templateData.metadata,
          updatedAt: new Date().toISOString()
        },
        isActive: true
      });

      await existingTemplate.save();
      console.log('Template actualizado exitosamente');
    } else {
      console.log('Creando nuevo template...');
      
      // Crear nuevo template
      const newTemplate = new EmailTemplate({
        category: templateData.category,
        name: templateData.name,
        subject: templateData.subject,
        preheader: templateData.preheader,
        htmlContent: templateData.htmlContent,
        textContent: templateData.textContent,
        description: templateData.description,
        variables: templateData.variables,
        tags: templateData.tags,
        metadata: templateData.metadata,
        isActive: true
      });

      await newTemplate.save();
      console.log('Template creado exitosamente');
    }

    // Verificar que se guardó correctamente
    const savedTemplate = await EmailTemplate.findOne({
      category: templateData.category,
      name: templateData.name
    });

    console.log('\nTemplate guardado:');
    console.log('ID:', savedTemplate._id);
    console.log('Categoría:', savedTemplate.category);
    console.log('Nombre:', savedTemplate.name);
    console.log('Variables:', savedTemplate.variables);
    console.log('Estado:', savedTemplate.isActive ? 'Activo' : 'Inactivo');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDesconectado de MongoDB');
  }
}

// Ejecutar el script
seedTemplate();