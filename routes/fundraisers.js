"use strict";
const express = require("express");
function createFundraisersRouter({ service }) { const router=express.Router(); router.get("/", async (_req,res)=>{ try { const data=service.getCached(); res.set("Cache-Control","public, max-age=60, stale-while-revalidate=300"); res.json(data); } catch { res.status(503).json({ok:false,error:"fundraisers_unavailable"}); } }); return router; }
module.exports = { createFundraisersRouter };
