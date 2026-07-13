#!/usr/bin/env node

require("dotenv").config();

const express = require("express");
const core = require("./index");

const {
  createSubscriptionsRouter,
} = require('./routes/subscriptions');

const app = express();

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3010);

app.set("trust proxy", true);

/*
 * ВАЖНО:
 * Mixplat webhook должен быть зарегистрирован ДО express.json()
 * и express.urlencoded().
 *
 * Обработчик handleMixplatWebhook() самостоятельно читает сырой поток req,
 * потому что сырой body нужен для проверки подписи Mixplat.
 *
 * Если сначала запустить express.json(), поток уже будет прочитан,
 * и readRequestBody(req) внутри обработчика зависнет.
 */
app.post("/mixplat/webhook", async (req, res) => {
  try {
    const urlObject = new URL(
      req.originalUrl,
      "http://localhost"
    );

    return await core.handleMixplatWebhook(
      req,
      res,
      urlObject
    );
  } catch (error) {
    console.error(
      "MIXPLAT WEBHOOK ROUTE ERROR:",
      error?.response?.data || error?.message || error
    );

    if (!res.headersSent) {
      return res.status(500).json({
        ok: false,
        error: "webhook_route_failed",
      });
    }

    return null;
  }
});

/*
 * Остальные маршруты могут использовать стандартный body parser Express.
 */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "kotocats-core",
  });
});

app.use("/api/donations", core.donationsRouter);

app.use(
  '/api/subscriptions',
  createSubscriptionsRouter()
);

core.initMixplatDonations();

app.listen(PORT, HOST, () => {
  console.log(
    `kotocats-core started on http://${HOST}:${PORT}`
  );
});
