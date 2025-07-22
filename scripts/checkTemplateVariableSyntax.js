const mongoose = require('mongoose');
const dotenv = require('dotenv');
const retrieveSecrets = require('../config/env');
const fs = require('fs/promises');
const path = require('path');
const { EmailTemplate } = require('../models');

async function checkTemplates() {
  try {
    // Cargar variables de entorno
    const secretsString = await retrieveSecrets();
    await fs.writeFile(path.join(__dirname, '..', '.env'), secretsString);
    dotenv.config({ path: path.join(__dirname, '..', '.env') });
    
    // Conectar a MongoDB
    const mongoUri = process.env.URLDB;
    
    if (!mongoUri) {
      console.log('URLDB no está definida en las variables de entorno');
      return;
    }
    
    await mongoose.connect(mongoUri);
    console.log('Conectado a MongoDB\n');

    // Buscar todos los templates
    const templates = await EmailTemplate.find({});
    
    console.log(`Total de templates encontrados: ${templates.length}\n`);
    
    // Regex para buscar variables con sintaxis incorrecta ${variable}
    const incorrectSyntaxRegex = /\$\{[^}]+\}/g;
    
    // Arrays para almacenar resultados
    const templatesWithIncorrectSyntax = [];
    const allTemplateDetails = [];
    
    // Revisar cada template
    for (const template of templates) {
      const details = {
        id: template._id,
        category: template.category,
        name: template.name,
        status: template.isActive ? 'Activo' : 'Inactivo',
        issues: []
      };
      
      // Verificar subject
      if (template.subject) {
        const subjectMatches = template.subject.match(incorrectSyntaxRegex);
        if (subjectMatches) {
          details.issues.push({
            field: 'subject',
            incorrectVariables: subjectMatches,
            content: template.subject
          });
        }
      }
      
      // Verificar htmlContent/htmlBody
      const htmlField = template.htmlContent || template.htmlBody;
      if (htmlField) {
        const htmlMatches = htmlField.match(incorrectSyntaxRegex);
        if (htmlMatches) {
          details.issues.push({
            field: 'htmlContent',
            incorrectVariables: htmlMatches,
            content: htmlField.substring(0, 200) + '...' // Mostrar solo primeros 200 caracteres
          });
        }
      }
      
      // Verificar textContent/textBody
      const textField = template.textContent || template.textBody;
      if (textField) {
        const textMatches = textField.match(incorrectSyntaxRegex);
        if (textMatches) {
          details.issues.push({
            field: 'textContent',
            incorrectVariables: textMatches,
            content: textField.substring(0, 200) + '...' // Mostrar solo primeros 200 caracteres
          });
        }
      }
      
      // Verificar preheader
      if (template.preheader) {
        const preheaderMatches = template.preheader.match(incorrectSyntaxRegex);
        if (preheaderMatches) {
          details.issues.push({
            field: 'preheader',
            incorrectVariables: preheaderMatches,
            content: template.preheader
          });
        }
      }
      
      allTemplateDetails.push(details);
      
      if (details.issues.length > 0) {
        templatesWithIncorrectSyntax.push(details);
      }
    }
    
    // Mostrar resumen
    console.log('=== RESUMEN DE TEMPLATES ===\n');
    console.log(`Templates totales: ${templates.length}`);
    console.log(`Templates con sintaxis incorrecta (\${}): ${templatesWithIncorrectSyntax.length}`);
    console.log(`Templates con sintaxis correcta ({{}}): ${templates.length - templatesWithIncorrectSyntax.length}\n`);
    
    // Listar todos los templates
    console.log('=== LISTA DE TODOS LOS TEMPLATES ===\n');
    for (const details of allTemplateDetails) {
      console.log(`Template: ${details.category}/${details.name}`);
      console.log(`ID: ${details.id}`);
      console.log(`Estado: ${details.status}`);
      
      if (details.issues.length > 0) {
        console.log('❌ PROBLEMAS ENCONTRADOS:');
        for (const issue of details.issues) {
          console.log(`  Campo: ${issue.field}`);
          console.log(`  Variables incorrectas: ${issue.incorrectVariables.join(', ')}`);
        }
      } else {
        console.log('✅ Sin problemas de sintaxis');
      }
      console.log('---\n');
    }
    
    // Si hay templates con problemas, mostrar detalles
    if (templatesWithIncorrectSyntax.length > 0) {
      console.log('\n=== TEMPLATES QUE NECESITAN CORRECCIÓN ===\n');
      
      for (const template of templatesWithIncorrectSyntax) {
        console.log(`\nTemplate: ${template.category}/${template.name}`);
        console.log(`ID: ${template.id}`);
        console.log('Problemas encontrados:');
        
        for (const issue of template.issues) {
          console.log(`\n  Campo: ${issue.field}`);
          console.log(`  Variables incorrectas encontradas: ${issue.incorrectVariables.join(', ')}`);
          console.log(`  Deberían ser: ${issue.incorrectVariables.map(v => v.replace(/\$\{([^}]+)\}/, '{{$1}}')).join(', ')}`);
          console.log(`  Preview del contenido:`);
          console.log(`  ${issue.content}`);
        }
      }
      
      console.log('\n\n=== RECOMENDACIÓN ===');
      console.log('Para corregir estos templates, las variables deben usar la sintaxis {{variable}} en lugar de ${variable}');
      console.log('Ejemplo: ${userName} debe ser {{userName}}');
    } else {
      console.log('\n✅ ¡Excelente! Todos los templates usan la sintaxis correcta {{variable}}');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDesconectado de MongoDB');
  }
}

// Ejecutar el script
checkTemplates();