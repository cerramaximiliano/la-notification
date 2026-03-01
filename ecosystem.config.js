module.exports = {
    apps: [
        {
            name: 'notification-service',
            script: 'app.js',
            exec_mode: 'fork',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',
            env: {
                NODE_ENV: 'development',
                FORCE_COLOR: '1', // Habilitar colores en los logs
            },
            env_production: {
                NODE_ENV: 'production',
                FORCE_COLOR: '1', // Habilitar colores en los logs
            },
            error_file: 'logs/pm2-error.log',
            out_file: 'logs/pm2-out.log',
            merge_logs: true,
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            // Reiniciar cada día a las 3:00 AM para garantizar frescura
            cron_restart: '0 3 * * *',
            // Reiniciar si la memoria excede 800MB
            max_memory_restart: '800M',
            // Reiniciar si la aplicación se bloquea
            restart_delay: 4000,
            // Esperar a que se maneje correctamente el proceso de parada antes de forzar
            kill_timeout: 5000,
            // Argumentos de línea de comandos adicionales para node
            node_args: '--max-old-space-size=512',
            // Directorio de trabajo (donde se ejecutará el script)
            cwd: './',
            // Reiniciar al cambiar estas rutas (útil en desarrollo, desactivado de forma predeterminada)
            watch: false,
            // Con ignore_watch, puedes especificar archivos o carpetas que no deben provocar un reinicio
            ignore_watch: ['logs', 'node_modules'],
        },
    ],
};