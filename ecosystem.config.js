module.exports = {
  apps: [
    {
      name: "core",
      script: "app.js",
      cwd: "/opt/kotocats-core",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
