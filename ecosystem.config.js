module.exports = {
  apps: [
    {
      name: "core",
      script: "app.js",
      cwd: "/opt/kotocats-core",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      env: {
        NODE_ENV: "development",
      },
    },
  ],
};
