#!/usr/bin/env node

require("dotenv").config();

const express = require("express");
const core = require("./index");
const avatarEditorRouter = require("./avatar-editor/routes/avatar-editor");
const createAssetsRouter = require("./routes/assets");
const { createAnimalReviewsRouter } = require("./routes/animal-reviews-router");
const { createSubscriptionsRouter } = require("./routes/subscriptions");

const app = express();
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3010);

app.set("trust proxy", true);

app.post("/mixplat/webhook", async (req, res) => {
  try {
    const urlObject = new URL(req.originalUrl, "http://localhost");
    return await core.handleMixplatWebhook(req, res, urlObject);
  } catch (error) {
    console.error("MIXPLAT WEBHOOK ROUTE ERROR:", error?.response?.data || error?.message || error);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: "webhook_route_failed" });
    return null;
  }
});

app.use(createAnimalReviewsRouter());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/api", createAssetsRouter());
app.use(avatarEditorRouter());

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "kotocats-core" });
});

app.use("/api/donations", core.donationsRouter);
app.use("/api/subscriptions", createSubscriptionsRouter());

core.initMixplatDonations();

app.listen(PORT, HOST, () => {
  console.log(`kotocats-core started on http://${HOST}:${PORT}`);
});
