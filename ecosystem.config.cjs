// ============================================================================
// Open Posting — PM2 Ecosystem Configuration
// Keeps all services running 24/7 with auto-restart
// ============================================================================

module.exports = {
  apps: [
    {
      name: 'open-posting-api',
      script: 'npx',
      args: 'tsx src/server.ts',
      cwd: './apps/api',
      node_args: '--env-file=../../.env',
      watch: false,
      autorestart: true,
      max_restarts: 50,
      min_uptime: '10s',
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      merge_logs: true,
      log_type: 'json',
    },
  ],
};
